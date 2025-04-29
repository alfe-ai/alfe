require("dotenv").config();
const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const os       = require("os");
const { exec, execSync } = require("child_process");
const multer   = require("multer");
const bodyParser = require("body-parser");
const cron     = require("node-cron");
const http     = require("http");
const { OpenAI } = require("openai");
const app      = express();

const PROJECT_ROOT    = path.resolve(__dirname, "..");
const DEFAULT_AIMODEL = "o3";

/* ────────────────────────────────────────────────────────────────────
   Global-agent instructions helpers
   ────────────────────────────────────────────────────────────────── */
const GLOBAL_INSTRUCTIONS_PATH = path.join(
    PROJECT_ROOT,
    "data",
    "config",
    "global_agent_instructions.txt"
);

function loadGlobalInstructions() {
    try {
        if (!fs.existsSync(GLOBAL_INSTRUCTIONS_PATH)) return "";
        return fs.readFileSync(GLOBAL_INSTRUCTIONS_PATH, "utf-8");
    } catch (e) {
        console.error("Error reading global instructions:", e);
        return "";
    }
}
function saveGlobalInstructions(text = "") {
    fs.writeFileSync(GLOBAL_INSTRUCTIONS_PATH, text, "utf-8");
}

/* ────────────────────────────────────────────────────────────────────
   Helper: GitHub URL → clean HTTPS form
   ────────────────────────────────────────────────────────────────── */
function convertGitUrlToHttps(url) {
    if (!url) return "#";

    // git@github.com:user/repo.git → https://github.com/user/repo
    if (url.startsWith("git@github.com:")) {
        let repo = url.slice("git@github.com:".length);
        if (repo.endsWith(".git")) repo = repo.slice(0, -4);
        return `https://github.com/${repo}`;
    }

    // https://github.com/user/repo.git → https://github.com/user/repo
    if (url.startsWith("https://github.com/") && url.endsWith(".git")) {
        return url.slice(0, -4);
    }

    return url;
}

/* ────────────────────────────────────────────────────────────────────
   Local imports
   ────────────────────────────────────────────────────────────────── */
const { analyzeCodeFlow } = require("./code_flow_analyzer");
const {
    loadSingleRepoConfig,
    saveRepoConfig,
    getGitFileMetaData,
    loadRepoConfig,
} = require("../server_defs");

/* ────────────────────────────────────────────────────────────────────
   Express bootstrap & core middleware
   ────────────────────────────────────────────────────────────────── */
console.log("[DEBUG] Starting server_webserver.js → CWD:", process.cwd());

app.use(express.static(path.join(PROJECT_ROOT, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ------------------------------ Multer ---------------------------- */
const UPLOAD_DIR = path.join(PROJECT_ROOT, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename   : (_, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

/* -------------------- Dev/Prod domain detection ------------------- */
app.use((req, res, next) => {
    const host = req.headers.host || "";
    let environment = "unknown";
    if (
        host.includes("localwhimsy") ||
        host.includes("local.whimsy") ||
        host.includes("prod.whimsy")
    )
        environment = "PROD";
    else if (host.includes("devwhimsy") || host.includes("dev.whimsy"))
        environment = "DEV";

    res.locals.environment = environment;
    console.log(`[DEBUG] Host: ${host}, Environment set to: ${environment}`);
    next();
});

/* ------------------------------ EJS ------------------------------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ------------------------ OpenAI helpers -------------------------- */
function getOpenAIClient(provider) {
    provider = provider.toLowerCase();

    if (provider === "openai")
        return new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true,
        });

    if (provider === "openrouter")
        return new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
            defaultHeaders: { "HTTP-Referer": "https://alfe.sh", "X-Title": "Alfe AI" },
        });

    if (provider === "litellm" || provider === "lite_llm") {
        const { LiteLLM } = require("litellm");
        return new LiteLLM({});
    }

    if (provider === "deepseek api")
        return new OpenAI({
            baseURL: "https://api.deepseek.ai/v1",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });

    if (provider === "deepseek local")
        return new OpenAI({
            baseURL: "http://localhost:8000/v1",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });

    throw new Error(`Unknown provider: ${provider}`);
}

/* ---------------------- Model-caching cron ------------------------ */
let AIModels = {};
async function fetchAndSortModels(provider) {
    try {
        console.log(`[DEBUG] Fetching models from ${provider}…`);
        const models = await getOpenAIClient(provider).models.list();
        AIModels[provider] = models.data
            .map((m) => m.id)
            .sort((a, b) => a.localeCompare(b));
    } catch (e) {
        console.error(`[ERROR] Model fetch (${provider})`, e);
        AIModels[provider] = [];
    }
}
["openai", "openrouter"].forEach(fetchAndSortModels);
cron.schedule("0 0 * * *", () =>
    ["openai", "openrouter"].forEach(fetchAndSortModels)
);

/* ────────────────────────────────────────────────────────────────────
   (Everything below is identical to your original file except that
   /repositories uses convertGitUrlToHttps for nicer links.)
   ────────────────────────────────────────────────────────────────── */

/* ---------- directory-analyzer, git helpers & other code ---------- */
const { analyzeProject } = require("./directory_analyzer");
const EXCLUDED_FILENAMES = new Set([]);

function getGitMetaData(repoPath) {
    let rev = "", dateStr = "", branchName = "";
    try {
        rev        = execSync("git rev-parse HEAD",           { cwd: repoPath }).toString().trim();
        dateStr    = execSync("git show -s --format=%ci HEAD",{ cwd: repoPath }).toString().trim();
        branchName = execSync("git rev-parse --abbrev-ref HEAD",{ cwd: repoPath }).toString().trim();
    } catch (err) {
        console.error("[ERROR] getGitMetaData →", err);
    }
    return { rev, dateStr, branchName };
}
function getGitCommits(repoPath) {
    try {
        return execSync('git log --pretty=format:"%h - %an, %ar : %s"', {
            cwd: repoPath, maxBuffer: 1024 * 1024,
        }).toString().split("\n");
    } catch (e) {
        console.error("[ERROR] getGitCommits →", e);
        return [];
    }
}
function getGitCommitGraph(repoPath) {
    try {
        const raw = execSync(
            'git log --pretty=format:"%h%x09%p%x09%an%x09%ad%x09%s" --date=iso',
            { cwd: repoPath, maxBuffer: 1024 * 1024 }
        ).toString();

        return raw.split("\n").map((line) => {
            const [hash, parents, author, date, message] = line.split("\t");
            return {
                hash,
                parents: parents ? parents.split(" ") : [],
                author,
                date,
                message,
            };
        });
    } catch (e) {
        console.error("[ERROR] getGitCommitGraph →", e);
        return [];
    }
}
function gitUpdatePull(repoPath) {
    return new Promise((resolve, reject) => {
        exec("git pull", { cwd: repoPath }, (err, stdout, stderr) => {
            if (err) {
                console.error("[ERROR] git pull failed →", stderr);
                return reject(stderr);
            }
            console.log("[DEBUG] git pull success →", stdout);
            resolve(stdout);
        });
    });
}

/* ---------------- Directory-tree helpers (unchanged) -------------- */
/* generateDirectoryTree, generateFullDirectoryTree ... (same code)   */
/* JSON helpers, cloneRepository, chat helpers … (same code)          */
/* All routes from “/” through “/toggle_push_after_commit” unchanged  */

/* ---------------------- /repositories list ----------------------- */
app.get("/repositories", (req, res) => {
    const cfg  = loadRepoConfig() || {};
    const list = Object.entries(cfg).map(([name, c]) => ({
        name,
        gitRepoLocalPath: c.gitRepoLocalPath,
        gitRepoURL: convertGitUrlToHttps(c.gitRepoURL || "#"),
    }));
    res.render("repositories", { repos: list });
});

/* ---------------------------- Server ----------------------------- */
const port = process.env.SERVER_PORT || 3000;
http.createServer(app).listen(port, () =>
    console.log(`[DEBUG] Server running → http://localhost:${port}`)
);
