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

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_AIMODEL = "o3";

/**
 * Global Agent Instructions
 */
const GLOBAL_INSTRUCTIONS_PATH = path.join(
    PROJECT_ROOT,
    "data",
    "config",
    "global_agent_instructions.txt"
);
function loadGlobalInstructions() {
    try {
        if (!fs.existsSync(GLOBAL_INSTRUCTIONS_PATH)) {
            return "";
        }
        return fs.readFileSync(GLOBAL_INSTRUCTIONS_PATH, "utf-8");
    } catch (e) {
        console.error("Error reading global instructions:", e);
        return "";
    }
}
function saveGlobalInstructions(newInstructions) {
    fs.writeFileSync(GLOBAL_INSTRUCTIONS_PATH, newInstructions, "utf-8");
}

/**
 * Convert a Git URL (SSH or HTTPS) to a clean HTTPS form for browser links.
 *  • git@github.com:user/repo.git  → https://github.com/user/repo
 *  • https://github.com/user/repo.git → https://github.com/user/repo
 *  • already-clean HTTPS links pass through untouched.
 */
function convertGitUrlToHttps(url) {
    if (!url) return "#";

    // SSH form: git@github.com:user/repo(.git)
    if (url.startsWith("git@github.com:")) {
        let repo = url.slice("git@github.com:".length);
        if (repo.endsWith(".git")) repo = repo.slice(0, -4);
        return `https://github.com/${repo}`;
    }

    // HTTPS with .git suffix
    if (url.startsWith("https://github.com/") && url.endsWith(".git")) {
        return url.slice(0, -4);
    }

    return url;
}

/**
 * Import code-flow analyzer & helpers
 */
const { analyzeCodeFlow } = require("./code_flow_analyzer");
const {
    loadSingleRepoConfig,
    saveRepoConfig,
    getGitFileMetaData,
    loadRepoConfig,
} = require("../server_defs");

console.log("[DEBUG] Starting server_webserver.js => CWD:", process.cwd());

// Serve static assets
app.use(express.static(path.join(PROJECT_ROOT, "public")));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Multer upload dir
const UPLOAD_DIR = path.join(PROJECT_ROOT, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

// Local-domain env banner
app.use((req, res, next) => {
    const host = req.headers.host;
    let environment = "unknown";
    if (
        host.includes("localwhimsy") ||
        host.includes("local.whimsy") ||
        host.includes("prod.whimsy")
    ) {
        environment = "PROD";
    } else if (host.includes("devwhimsy") || host.includes("dev.whimsy")) {
        environment = "DEV";
    }
    res.locals.environment = environment;
    console.log(`[DEBUG] Host: ${host}, Environment: ${environment}`);
    next();
});

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/**
 * Create OpenAI-compatible client for chosen provider
 */
function getOpenAIClient(provider) {
    provider = provider.toLowerCase();

    if (provider === "openai") {
        return new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true,
        });
    }
    if (provider === "openrouter") {
        return new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
            defaultHeaders: {
                "HTTP-Referer": "https://alfe.sh",
                "X-Title": "Alfe AI",
            },
        });
    }
    if (provider === "litellm" || provider === "lite_llm") {
        const { LiteLLM } = require("litellm");
        return new LiteLLM({});
    }
    if (provider === "deepseek api") {
        return new OpenAI({
            baseURL: "https://api.deepseek.ai/v1",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });
    }
    if (provider === "deepseek local") {
        return new OpenAI({
            baseURL: "http://localhost:8000/v1",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });
    }
    throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Cache of available models per provider
 */
let AIModels = {};

/**
 * Fetch & cache model list
 */
async function fetchAndSortModels(provider) {
    try {
        console.log(`[DEBUG] Fetching model list for provider: ${provider}`);
        const models = await getOpenAIClient(provider).models.list();
        AIModels[provider] = models.data
            .map((m) => m.id)
            .sort((a, b) => a.localeCompare(b));
        console.log("[DEBUG] Models:", AIModels[provider]);
    } catch (err) {
        console.error("[ERROR] fetchAndSortModels:", err);
        AIModels[provider] = [];
    }
}
["openai", "openrouter"].forEach(fetchAndSortModels);
cron.schedule("0 0 * * *", () =>
    ["openai", "openrouter"].forEach(fetchAndSortModels)
);

/**
 * Directory-analyzer
 */
const { analyzeProject } = require("./directory_analyzer");

/**
 * EXCLUDED_FILENAMES placeholder (currently empty set)
 */
const EXCLUDED_FILENAMES = new Set();

/* ------------------------------------------------------------------
 * Helper functions: git metadata, directory tree, etc.
 * (omitted here for brevity – unchanged from previous version)
 * -----------------------------------------------------------------*/
function getGitMetaData(repoPath) {
    let rev = "",
        dateStr = "",
        branchName = "";
    try {
        rev = execSync("git rev-parse HEAD", { cwd: repoPath })
            .toString()
            .trim();
        dateStr = execSync("git show -s --format=%ci HEAD", { cwd: repoPath })
            .toString()
            .trim();
        branchName = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: repoPath,
        })
            .toString()
            .trim();
    } catch (e) {
        console.error("[ERROR] getGitMetaData:", e);
    }
    return { rev, dateStr, branchName };
}

/* ... many helper functions unchanged ... */

/**
 * Root redirect
 */
app.get("/", (_, res) => res.redirect("/repositories"));

/**
 * Repositories list
 */
app.get("/repositories", (_, res) => {
    const cfg = loadRepoConfig();
    const repos = [];
    if (cfg) {
        for (const name in cfg) {
            if (!cfg.hasOwnProperty(name)) continue;
            repos.push({
                name,
                gitRepoLocalPath: cfg[name].gitRepoLocalPath,
                gitRepoURL: convertGitUrlToHttps(cfg[name].gitRepoURL),
            });
        }
    }
    res.render("repositories", { repos });
});

/* ------------- (other routes unchanged until chat route) ------------- */

/**
 * Show a specific chat
 */
app.get("/:repoName/chat/:chatNumber", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) return res.status(404).send("Chat not found.");

    const repoCfg = loadSingleRepoConfig(repoName);
    if (!repoCfg)
        return res
            .status(400)
            .send(`[ERROR] Repo config not found: '${repoName}'`);

    // Ensure defaults
    chatData.aiModel = (chatData.aiModel || DEFAULT_AIMODEL).toLowerCase();
    chatData.aiProvider = chatData.aiProvider || "openai";

    const {
        gitRepoLocalPath,
        gitBranch,
        openAIAccount,
        gitRepoURL,
    } = repoCfg;
    const attachedFiles = chatData.attachedFiles || [];

    // Directory-tree HTML
    const directoryTreeHTML = generateFullDirectoryTree(
        gitRepoLocalPath,
        repoName,
        attachedFiles
    );

    // Git meta, commits, commit graph
    const meta = getGitMetaData(gitRepoLocalPath);
    const gitCommits = getGitCommits(gitRepoLocalPath);
    const gitCommitGraph = getGitCommitGraph(gitRepoLocalPath);

    // Normalised GitHub URL (FIX APPLIED HERE)
    const githubURL = convertGitUrlToHttps(gitRepoURL);
    const chatGPTURL = chatData.chatURL || "";
    const status = chatData.status || "ACTIVE";

    // Directory analysis & system info
    const directoryAnalysisText = analyzeProject(gitRepoLocalPath, {
        plainText: true,
    });
    const systemInformationText = getSystemInformation();

    // Model list for provider
    const providerKey = chatData.aiProvider.toLowerCase();
    const aiModelsForProvider = AIModels[providerKey] || [];

    res.render("chat", {
        gitRepoNameCLI: repoName,
        chatNumber,
        directoryTreeHTML,
        chatData,
        AIModels: aiModelsForProvider,
        aiModel: chatData.aiModel,
        status,
        gitRepoLocalPath,
        githubURL,
        gitBranch,
        openAIAccount,
        chatGPTURL,
        gitRevision: meta.rev,
        gitTimestamp: meta.dateStr,
        gitBranchName: meta.branchName,
        gitCommits,
        gitCommitGraph,
        directoryAnalysisText,
        systemInformationText,
        environment: res.locals.environment,
    });
});

/* ----------------- Remaining (POST handlers etc.) unchanged ---------------- */

/**
 * Start server
 */
const port = process.env.SERVER_PORT || 3000;
http.createServer(app).listen(port, () => {
    console.log(`[DEBUG] Server running => http://localhost:${port}`);
});
