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
const { OpenAI } = require('openai');
const app = express();

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_AIMODEL = "o3";

/**
 * Global Agent Instructions
 */
const GLOBAL_INSTRUCTIONS_PATH = path.join(PROJECT_ROOT, "data", "config", "global_agent_instructions.txt");
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
 * Convert a git URL (SSH or HTTPS) to clean HTTPS form for browser links
 * Examples:
 *   git@github.com:user/repo.git  → https://github.com/user/repo
 *   https://github.com/user/repo.git → https://github.com/user/repo
 */
function convertGitUrlToHttps(url) {
    if (!url) return "#";

    if (url.startsWith("git@github.com:")) {
        let repo = url.slice("git@github.com:".length);
        if (repo.endsWith(".git")) repo = repo.slice(0, -4);
        return `https://github.com/${repo}`;
    }
    if (url.startsWith("https://github.com/") && url.endsWith(".git")) {
        return url.slice(0, -4);
    }
    return url;
}

/**
 * Import code flow analyzer
 */
const { analyzeCodeFlow } = require("./code_flow_analyzer");
const {
    loadSingleRepoConfig,
    saveRepoConfig,
    getGitFileMetaData,
    loadRepoConfig,
} = require("../server_defs");

console.log("[DEBUG] Starting server_webserver.js => CWD:", process.cwd());

// Serve static files from public/
app.use(express.static(path.join(PROJECT_ROOT, "public")));

// Removed the route that served the .ico favicon

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Set up multer for file uploads
const UPLOAD_DIR = path.join(PROJECT_ROOT, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    },
});
const upload = multer({ storage: storage });

// Custom middleware to handle local domains
app.use((req, res, next) => {
    const host = req.headers.host;
    let environment;
    if (
        host.includes("localwhimsy") ||
        host.includes("local.whimsy") ||
        host.includes("prod.whimsy")
    ) {
        environment = "PROD";
    } else if (host.includes("devwhimsy") || host.includes("dev.whimsy")) {
        environment = "DEV";
    } else {
        environment = "unknown";
    }
    res.locals.environment = environment;
    console.log(`[DEBUG] Host: ${host}, Environment set to: ${environment}`);
    next();
});

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/**
 * Get OpenAI client according to provider
 */
function getOpenAIClient(provider) {
    provider = provider.toLowerCase();

    if (provider === 'openai') {
        return new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true,
        });
    } else if (provider === 'openrouter') {
        return new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
            defaultHeaders: {
                "HTTP-Referer": "https://alfe.sh",
                "X-Title": "Alfe AI",
            },
        });
    } else if (provider === 'litellm' || provider === 'lite_llm') {
        const { LiteLLM } = require('litellm');
        return new LiteLLM({ /* options */ });
    } else if (provider === 'deepseek api') {
        return new OpenAI({
            baseURL: "https://api.deepseek.ai/v1",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });
    } else if (provider === 'deepseek local') {
        return new OpenAI({
            baseURL: "http://localhost:8000/v1",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });
    } else {
        throw new Error(`Unknown provider: ${provider}`);
    }
}

/**
 * Global AI models per provider
 */
let AIModels = {};

/**
 * Fetch and sort models for a provider
 */
async function fetchAndSortModels(provider) {
    try {
        console.log(`[DEBUG] Attempting to fetch AI models from provider: ${provider}...`);
        const client = getOpenAIClient(provider);
        const modelsResponse = await client.models.list();
        const modelIds = modelsResponse.data.map((m) => m.id);

        AIModels[provider] = modelIds.sort((a, b) => a.localeCompare(b));
        console.log(`[DEBUG] Fetched and sorted AI models for ${provider} =>`, AIModels[provider]);
    } catch (error) {
        console.error(`[ERROR] Fetching models for ${provider} =>`, error);
        AIModels[provider] = [];
    }
}

// Fetch models for initial providers
const initialProviders = ['openai', 'openrouter'];
initialProviders.forEach(provider => fetchAndSortModels(provider));

// Daily refresh
cron.schedule("0 0 * * *", () => {
    console.log("[DEBUG] Scheduled daily model refresh => fetchAndSortModels()");
    initialProviders.forEach(provider => fetchAndSortModels(provider));
});

/**
 * Import directory analyzer
 */
const { analyzeProject } = require("./directory_analyzer");

/**
 * Filenames to skip
 */
const EXCLUDED_FILENAMES = new Set([]);

/* … (unmodified code continues until /repositories route) … */

/**
 * /repositories => show all
 */
app.get("/repositories", (req, res) => {
    const repoConfig = loadRepoConfig();
    const repoList = [];
    if (repoConfig) {
        for (const repoName in repoConfig) {
            if (repoConfig.hasOwnProperty(repoName)) {
                repoList.push({
                    name: repoName,
                    gitRepoLocalPath: repoConfig[repoName].gitRepoLocalPath,
                    gitRepoURL: convertGitUrlToHttps(repoConfig[repoName].gitRepoURL),
                });
            }
        }
    }
    res.render("repositories", { repos: repoList });
});

/* … (the rest of the file is unchanged) … */

/**
 * Start server on specified port
 */
const port = process.env.SERVER_PORT || 3000;
const server = http.createServer(app);
server.listen(port, () => {
    console.log(`[DEBUG] Server running => http://localhost:${port}`);
});
