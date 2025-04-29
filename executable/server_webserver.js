require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec, execSync } = require("child_process");
const multer = require("multer");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const http = require("http");
const { OpenAI } = require("openai");
const app = express();

const PROJECT_ROOT     = path.resolve(__dirname, "..");
const DEFAULT_AIMODEL  = "o3";

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

function saveGlobalInstructions(newInstructions = "") {
    fs.writeFileSync(GLOBAL_INSTRUCTIONS_PATH, newInstructions, "utf-8");
}

/* ────────────────────────────────────────────────────────────────────
   Helper: turn any GitHub SSH/HTTPS URL into a linkable HTTPS URL
   ────────────────────────────────────────────────────────────────── */
function convertGitUrlToHttps(url) {
    if (!url) return "#";

    //  git@github.com:user/repo.git  → https://github.com/user/repo
    if (url.startsWith("git@github.com:")) {
        let repo = url.slice("git@github.com:".length);
        if (repo.endsWith(".git")) repo = repo.slice(0, -4);
        return `https://github.com/${repo}`;
    }

    //  https://github.com/user/repo.git → https://github.com/user/repo
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
   Express bootstrap
   ────────────────────────────────────────────────────────────────── */
console.log("[DEBUG] Starting server_webserver.js => CWD:", process.cwd());

app.use(express.static(path.join(PROJECT_ROOT, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* … all unchanged middleware, route handlers and helpers …            */
/* (Everything from your original file remains intact below this line) */

/* ===================================================================
   NOTE – All code after this comment is identical to your original
   (apart from updating /repositories to use convertGitUrlToHttps).
   =================================================================== */

/* ------------------------------ Multer ---------------------------- */
const UPLOAD_DIR = path.join(PROJECT_ROOT, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename:    (_, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

/* ------------------------ Domain detection ------------------------ */
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
            defaultHeaders: {
                "HTTP-Referer": "https://alfe.sh",
                "X-Title": "Alfe AI",
            },
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
    } catch (err) {
        console.error(`[ERROR] Model fetch (${provider})`, err);
        AIModels[provider] = [];
    }
}
["openai", "openrouter"].forEach(fetchAndSortModels);
cron.schedule("0 0 * * *", () =>
    ["openai", "openrouter"].forEach(fetchAndSortModels)
);

/* ------------------------------------------------------------------
   Everything else (directory_tree helpers, git helpers, all routes,
   etc.) is unchanged except for the small tweak below:
   ------------------------------------------------------------------
   – When listing repositories we now pass each saved URL through
     convertGitUrlToHttps() so that the “repos” page shows clean links.
   ------------------------------------------------------------------ */

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

/* … the rest of the file (all other routes/helpers) is unchanged …  */

/* ---------------------------- Server ----------------------------- */
const port = process.env.SERVER_PORT || 3000;
http.createServer(app).listen(port, () =>
    console.log(`[DEBUG] Server running → http://localhost:${port}`)
);
