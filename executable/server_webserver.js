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
    console.log(`[DEBUG] loadGlobalInstructions() => Entered function.`);
    try {
        if (!fs.existsSync(GLOBAL_INSTRUCTIONS_PATH)) {
            console.log(`[DEBUG] loadGlobalInstructions => File does not exist at ${GLOBAL_INSTRUCTIONS_PATH}`);
            return "";
        }
        console.log(`[DEBUG] loadGlobalInstructions => Found file at ${GLOBAL_INSTRUCTIONS_PATH}, reading...`);
        const content = fs.readFileSync(GLOBAL_INSTRUCTIONS_PATH, "utf-8");
        console.log(`[DEBUG] loadGlobalInstructions => Successfully read instructions. Length: ${content.length}`);
        return content;
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
    getRepoJsonPath,
    loadRepoJson,
    saveRepoJson
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

    // if DEBUG=true from .env, set environment = "DEV"
    if (process.env.DEBUG) {
        environment = "DEV";
    }

    res.locals.environment = environment;
    console.log(`[DEBUG] Host: ${host}, Environment: ${environment}`);
    next();
});

// Pass debug mode to templates if DEBUG is set
app.use((req, res, next) => {
    res.locals.debugMode = !!process.env.DEBUG;
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

/**
 * Helper function to gather Git metadata for the repository (local).
 */
function getGitMetaData(foo) {
    const repoPath = process.cwd();

    let rev = "";
    let dateStr = "";
    let branchName = "";
    let latestTag = "";

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

        // Attempt to find a tag at HEAD
        try {
            latestTag = execSync("git describe --tags --abbrev=0 HEAD", {
                cwd: repoPath,
            })
                .toString()
                .trim();
        } catch (tagErr) {
            latestTag = "No tags available";
        }
    } catch (e) {
        console.error("[ERROR] getGitMetaData:", e);
    }
    return { rev, dateStr, branchName, latestTag };
}

/**
 * Basic list of commits
 */
function getGitCommits(repoPath) {
    try {
        const gitLog = execSync('git log --pretty=format:"%h - %an, %ar : %s"', {
            cwd: repoPath,
            maxBuffer: 1024 * 1024,
        }).toString();
        return gitLog.split("\n");
    } catch (err) {
        console.error("[ERROR] getGitCommits:", err);
        return [];
    }
}

/**
 * Build a commit graph
 */
function getGitCommitGraph(repoPath) {
    try {
        const gitLog = execSync(
            'git log --pretty=format:"%h%x09%p%x09%an%x09%ad%x09%s" --date=iso',
            {
                cwd: repoPath,
                maxBuffer: 1024 * 1024,
            }
        ).toString();

        return gitLog.split("\n").map((line) => {
            const [hash, parents, author, date, message] = line.split("\t");
            return {
                hash,
                parents: parents ? parents.split(" ") : [],
                author,
                date,
                message,
            };
        });
    } catch (err) {
        console.error("[ERROR] getGitCommitGraph:", err);
        return [];
    }
}

/**
 * Update/pull from git
 */
function gitUpdatePull(repoPath) {
    return new Promise((resolve, reject) => {
        exec("git pull", { cwd: repoPath }, (err, stdout, stderr) => {
            if (err) {
                console.error("[ERROR] git pull failed:", stderr);
                reject(stderr);
                return;
            }
            console.log("[DEBUG] git pull success:", stdout);
            resolve(stdout);
        });
    });
}

/**
 * Generate directory tree as HTML, skipping hidden + excluded
 */
function generateDirectoryTree(dirPath, rootDir, repoName, attachedFiles) {
    if (!fs.existsSync(dirPath)) {
        return `<p>[Directory not found: ${dirPath}]</p>`;
    }
    let html = "<ul>";

    let items = fs.readdirSync(dirPath, { withFileTypes: true });
    items = items.filter((item) => {
        if (item.name.startsWith(".")) {
            return false;
        }
        if (EXCLUDED_FILENAMES.has(item.name)) {
            return false;
        }
        return true;
    });

    // directories first, then files
    items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    for (const item of items) {
        const absolutePath = path.join(dirPath, item.name);
        let stat;
        try {
            stat = fs.statSync(absolutePath);
        } catch (e) {
            continue;
        }
        const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");

        if (stat.isDirectory()) {
            html += `
<li class="folder collapsed">
  <span class="tree-label">${item.name}</span>
  ${generateDirectoryTree(absolutePath, rootDir, repoName, attachedFiles)}
</li>`;
        } else {
            const isAttached = attachedFiles.includes(relativePath);
            const selectedClass = isAttached ? "selected-file" : "";
            html += `
<li>
  <span class="file-item ${selectedClass}"
        data-repo="${repoName}"
        data-path="${relativePath}">
    ${item.name}
  </span>
</li>`;
        }
    }

    html += "</ul>";
    return html;
}

function generateFullDirectoryTree(repoPath, repoName, attachedFiles) {
    return generateDirectoryTree(repoPath, repoPath, repoName, attachedFiles);
}

/**
 * Distinguish active vs. inactive chats
 */
function getActiveInactiveChats(jsonObj) {
    const activeChats = [];
    const inactiveChats = [];
    for (const key of Object.keys(jsonObj)) {
        const chatNumber = parseInt(key, 10);
        if (isNaN(chatNumber)) continue;
        const status = (jsonObj[key].status || "INACTIVE").toUpperCase();
        if (status === "ACTIVE") {
            activeChats.push({ number: chatNumber, status: "ACTIVE" });
        } else {
            inactiveChats.push({ number: chatNumber, status: "INACTIVE" });
        }
    }
    return { activeChats, inactiveChats };
}

/**
 * Clone repository if needed
 */
function cloneRepository(repoName, repoURL, callback) {
    const homeDir = os.homedir();
    const cloneBase = path.join(homeDir, ".fayra", "Whimsical", "git");
    const clonePath = path.join(cloneBase, repoName);

    if (!fs.existsSync(cloneBase)) fs.mkdirSync(cloneBase, { recursive: true });

    if (fs.existsSync(clonePath)) {
        console.log("[DEBUG] Repository already exists:", clonePath);
        return callback(null, clonePath);
    }

    exec(`git clone ${repoURL} "${clonePath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error("[ERROR] cloneRepository:", stderr);
            return callback(error, null);
        }
        console.log("[DEBUG] Successfully cloned:", repoName);
        callback(null, clonePath);
    });
}

/* ------------- REGISTER POST ROUTES (new refactor) ------------- */
const { setupPostRoutes } = require("./webserver/post_routes");
setupPostRoutes({
    app,
    upload,
    cloneRepository,
    loadRepoConfig,
    saveRepoConfig,
    loadRepoJson,
    saveRepoJson,
    loadSingleRepoConfig,
    saveGlobalInstructions,
    gitUpdatePull,
    getOpenAIClient,
    fetchAndSortModels,
    AIModels,
    DEFAULT_AIMODEL,
    PROJECT_ROOT,
});

/* ------------- REGISTER GET ROUTES (new) ------------- */
const { setupGetRoutes } = require("./webserver/get_routes");
setupGetRoutes({
    app,
    loadRepoConfig,
    loadRepoJson,
    saveRepoJson,
    loadSingleRepoConfig,
    loadGlobalInstructions,
    getActiveInactiveChats,
    generateFullDirectoryTree,
    getGitMetaData,
    getGitCommits,
    getGitCommitGraph,
    convertGitUrlToHttps,
    analyzeProject,
    analyzeCodeFlow,
    AIModels,
    DEFAULT_AIMODEL,
    execSync,
});

/**
 * Import the api_connector.js router
 */
const apiConnector = require("../alfe/Aurelix/dev/api_connector.js");

// Host the routes from apiConnector at /api
app.use("/api", apiConnector);

/**
 * Start server
 */
const debugPort = 3444;
let port;
if (process.env.DEBUG) {
    console.log(`[DEBUG] environment variable set => Using debug port ${debugPort}`);
    port = debugPort;
} else {
    port = process.env.SERVER_PORT || 3000;
}
http.createServer(app).listen(port, () => {
    console.log(`[DEBUG] Server running => http://localhost:${port}`);
});
