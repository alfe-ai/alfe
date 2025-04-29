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
 * Repo JSON data
 */
function getRepoJsonPath(repoName) {
    const dataDir = path.join(PROJECT_ROOT, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, `${repoName}.json`);
}

function loadRepoJson(repoName) {
    const filePath = getRepoJsonPath(repoName);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "{}", "utf-8");
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
        console.error("[ERROR] loadRepoJson:", err);
        return {};
    }
}

function saveRepoJson(repoName, data) {
    const filePath = getRepoJsonPath(repoName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
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

/**
 * Root
 */
app.get("/", (req, res) => {
    res.redirect("/repositories");
});

/**
 * Global instructions
 */
app.get("/global_instructions", (req, res) => {
    const currentGlobal = loadGlobalInstructions();
    res.render("global_instructions", { currentGlobal });
});
app.post("/save_global_instructions", (req, res) => {
    const { globalInstructions } = req.body || {};
    saveGlobalInstructions(globalInstructions || "");
    res.redirect("/global_instructions");
});

/**
 * Repos listing
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
                    gitRepoURL: repoConfig[repoName].gitRepoURL || "#",
                });
            }
        }
    }
    res.render("repositories", { repos: repoList });
});

app.get("/repositories/add", (req, res) => {
    res.render("add_repository");
});
app.post("/repositories/add", (req, res) => {
    const { repoName, gitRepoURL } = req.body;
    if (!repoName || !gitRepoURL) {
        return res.status(400).send("Repository name and URL are required.");
    }
    const homeDir = os.homedir();
    const cloneBase = path.join(homeDir, ".fayra", "Whimsical", "git");
    const clonePath = path.join(cloneBase, repoName);

    if (fs.existsSync(clonePath)) {
        return res.status(400).send("Repository already exists.");
    }

    cloneRepository(repoName, gitRepoURL, (err, localPath) => {
        if (err) {
            return res.status(500).send("Failed to clone repository.");
        }
        const repoConfig = loadRepoConfig() || {};
        repoConfig[repoName] = {
            gitRepoLocalPath: localPath,
            gitRepoURL,
            gitBranch: "main",
            openAIAccount: "",
        };
        saveRepoConfig(repoConfig);
        res.redirect("/repositories");
    });
});

/**
 * Chats
 */
app.get("/:repoName", (req, res) => {
    res.redirect(`/${req.params.repoName}/chats`);
});
app.get("/:repoName/chats", (req, res) => {
    const repoName = req.params.repoName;
    const dataObj = loadRepoJson(repoName);
    const { activeChats, inactiveChats } = getActiveInactiveChats(dataObj);

    res.render("chats", {
        gitRepoNameCLI: repoName,
        activeChats,
        inactiveChats,
    });
});
app.get("/:repoName/chat", (req, res) => {
    const repoName = req.params.repoName;
    const dataObj = loadRepoJson(repoName);
    let maxChatNumber = 0;
    for (const key of Object.keys(dataObj)) {
        const chatNumber = parseInt(key, 10);
        if (!isNaN(chatNumber) && chatNumber > maxChatNumber) {
            maxChatNumber = chatNumber;
        }
    }
    const newChatNumber = maxChatNumber + 1;
    const defaultGlobals = loadGlobalInstructions();

    dataObj[newChatNumber] = {
        status: "ACTIVE",
        agentInstructions: defaultGlobals,
        attachedFiles: [],
        chatHistory: [],
        aiProvider: "openai",
        aiModel: DEFAULT_AIMODEL,
        pushAfterCommit: true,
    };
    saveRepoJson(repoName, dataObj);
    res.redirect(`/${repoName}/chat/${newChatNumber}`);
});

/**
 * Show a specific chat
 */
app.get("/:repoName/chat/:chatNumber", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }

    const repoCfg = loadSingleRepoConfig(repoName);
    if (!repoCfg) {
        return res
            .status(400)
            .send(`[ERROR] Repo config not found: '${repoName}'`);
    }

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

    const directoryTreeHTML = generateFullDirectoryTree(
        gitRepoLocalPath,
        repoName,
        attachedFiles
    );
    const meta = getGitMetaData(gitRepoLocalPath);
    const gitCommits = getGitCommits(gitRepoLocalPath);
    const gitCommitGraph = getGitCommitGraph(gitRepoLocalPath);

    const githubURL = convertGitUrlToHttps(gitRepoURL);
    const chatGPTURL = chatData.chatURL || "";
    const status = chatData.status || "ACTIVE";

    const { analyzeProject } = require("./directory_analyzer");
    const directoryAnalysisText = analyzeProject(gitRepoLocalPath, {
        plainText: true,
    });

    function getSystemInformation() {
        let output = "";
        try {
            execSync("command -v neofetch");
            output = execSync(
                "neofetch --config none --ascii off --color_blocks off --stdout"
            ).toString();
        } catch (error) {
            output = "[neofetch not available]";
        }
        return output;
    }
    const systemInformationText = getSystemInformation();

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

/**
 * Set chat model
 */
app.post("/set_chat_model", (req, res) => {
    const { gitRepoNameCLI, chatNumber, aiModel, aiProvider } = req.body;
    const dataObj = loadRepoJson(gitRepoNameCLI);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res
            .status(404)
            .send(
                `Chat #${chatNumber} not found in repo '${gitRepoNameCLI}'.`
            );
    }
    chatData.aiModel = aiModel;
    chatData.aiProvider = aiProvider;
    dataObj[chatNumber] = chatData;
    saveRepoJson(gitRepoNameCLI, dataObj);

    const provider = aiProvider.toLowerCase();
    if (!AIModels[provider]) {
        fetchAndSortModels(provider);
    }
    res.redirect(`/${gitRepoNameCLI}/chat/${chatNumber}`);
});

/**
 * Receive chat message
 */
app.post("/:repoName/chat/:chatNumber", upload.array("imageFiles"), async (req, res) => {
    try {
        const { repoName, chatNumber } = req.params;
        let userMessage = req.body.message || req.body.chatInput;
        if (!userMessage) {
            return res.status(400).json({ error: "No message provided" });
        }
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) {
            return res.status(404).json({
                error: `Chat #${chatNumber} not found in repo '${repoName}'.`,
            });
        }
        if (req.body.attachedFiles) {
            try {
                const parsed = JSON.parse(req.body.attachedFiles);
                chatData.attachedFiles = parsed;
            } catch (e) {
                console.error("[ERROR] parsing attachedFiles:", e);
            }
        }
        chatData.aiModel = (chatData.aiModel || DEFAULT_AIMODEL).toLowerCase();
        chatData.aiProvider = chatData.aiProvider || "openai";

        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) {
            return res.status(400).json({ error: "No repoConfig found." });
        }
        const { gitRepoLocalPath } = repoCfg;

        await gitUpdatePull(gitRepoLocalPath);

        const attachedFiles = chatData.attachedFiles || [];
        for (const filePath of attachedFiles) {
            const absoluteFilePath = path.join(gitRepoLocalPath, filePath);
            if (fs.existsSync(absoluteFilePath)) {
                const fileContents = fs.readFileSync(absoluteFilePath, "utf-8");
                userMessage += `\n\n===== Start of file: ${filePath} =====\n`;
                userMessage += fileContents;
                userMessage += `\n===== End of file: ${filePath} =====\n`;
            } else {
                userMessage += `\n\n[File not found: ${filePath}]\n`;
            }
        }

        if (req.files && req.files.length > 0) {
            chatData.uploadedImages = chatData.uploadedImages || [];
            for (const file of req.files) {
                const relativePath = path.relative(PROJECT_ROOT, file.path);
                chatData.uploadedImages.push(relativePath);
            }
            userMessage += `\n\nUser uploaded ${req.files.length} image(s).`;
        }
        const messages = [];
        if (chatData.agentInstructions) {
            messages.push({
                role: "user",
                content: chatData.agentInstructions,
            });
        }
        messages.push({ role: "user", content: userMessage });

        chatData.lastMessagesSent = messages;
        dataObj[chatNumber] = chatData;
        saveRepoJson(repoName, dataObj);

        const provider = chatData.aiProvider;
        const openaiClient = getOpenAIClient(provider);
        const response = await openaiClient.chat.completions.create({
            model: chatData.aiModel,
            messages,
        });
        const assistantReply = response.choices[0].message.content;

        const extractedFiles = parseAssistantReplyForFiles(assistantReply);
        const commitSummary = parseAssistantReplyForCommitSummary(assistantReply);

        for (const file of extractedFiles) {
            const filePath = path.join(gitRepoLocalPath, file.filename);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, file.content, "utf-8");
        }
        if (commitSummary) {
            try {
                // Use environment variables or fall back to defaults
                const commitUserName = process.env.GIT_COMMIT_USER_NAME || "YOURNAME";
                const commitUserEmail = process.env.GIT_COMMIT_USER_EMAIL || "YOURNAME@YOURDOMAIN.tld";
                execSync(`git config user.name "${commitUserName}"`, { cwd: gitRepoLocalPath });
                execSync(`git config user.email "${commitUserEmail}"`, { cwd: gitRepoLocalPath });
                execSync("git add .", { cwd: gitRepoLocalPath });
                execSync(`git commit -m "${commitSummary.replace(/"/g, '\\"')}"`, {
                    cwd: gitRepoLocalPath,
                });
                if (chatData.pushAfterCommit) {
                    execSync("git push", { cwd: gitRepoLocalPath });
                }
            } catch (err) {
                console.error("[ERROR] Git commit/push failed:", err);
            }
        }
        chatData.chatHistory = chatData.chatHistory || [];
        chatData.chatHistory.push({
            role: "user",
            content: userMessage,
            timestamp: new Date().toISOString(),
            messagesSent: messages,
        });
        chatData.chatHistory.push({
            role: "assistant",
            content: assistantReply,
            timestamp: new Date().toISOString(),
        });

        const summaryPrompt = `
Please summarize the following conversation between the user and the assistant.

User message:
${userMessage}

Assistant reply:
${assistantReply}

Summary:
`;
        const summaryMessages = [{ role: "user", content: summaryPrompt }];
        const summaryResponse = await openaiClient.chat.completions.create({
            model: chatData.aiModel,
            messages: summaryMessages,
        });
        const summaryText = summaryResponse.choices[0].message.content;
        chatData.summaryHistory = chatData.summaryHistory || [];
        chatData.summaryHistory.push({
            role: "assistant",
            content: summaryText,
            timestamp: new Date().toISOString(),
        });

        chatData.extractedFiles = chatData.extractedFiles || [];
        chatData.extractedFiles.push(...extractedFiles);

        dataObj[chatNumber] = chatData;
        saveRepoJson(repoName, dataObj);

        return res.status(200).json({
            success: true,
            assistantReply,
            updatedChat: chatData,
        });
    } catch (error) {
        console.error("[ERROR] /:repoName/chat/:chatNumber:", error);
        return res.status(500).json({ error: "Failed to process your message." });
    }
});

function parseAssistantReplyForFiles(assistantReply) {
    const fileRegex =
        /===== Start of file: (.+?) =====\s*([\s\S]*?)===== End of file: \1 =====/g;
    const files = [];
    let match;
    while ((match = fileRegex.exec(assistantReply)) !== null) {
        const filename = match[1];
        const content = match[2];
        files.push({ filename, content });
    }
    return files;
}

function parseAssistantReplyForCommitSummary(assistantReply) {
    const commitSummaryRegex = /A\.\s*Commit Summary\s*([\s\S]*?)B\.\s*Files/;
    const match = assistantReply.match(commitSummaryRegex);
    if (match && match[1]) {
        return match[1].trim();
    }
    return null;
}

/**
 * Git update
 */
app.post("/:repoName/git_update", async (req, res) => {
    const repoName = req.params.repoName;
    const repoCfg = loadSingleRepoConfig(repoName);
    if (!repoCfg) {
        return res.status(400).json({ error: `Repo '${repoName}' not found.` });
    }
    try {
        const pullOutput = await gitUpdatePull(repoCfg.gitRepoLocalPath);
        const currentCommit = execSync("git rev-parse HEAD", {
            cwd: repoCfg.gitRepoLocalPath,
        })
            .toString()
            .trim();
        res.json({ success: true, currentCommit, pullOutput });
    } catch (err) {
        console.error("[ERROR] gitUpdatePull:", err);
        res.status(500).json({ error: "Failed to update repository." });
    }
});

/**
 * Code flow
 */
app.get("/code_flow", (req, res) => {
    const routes = analyzeCodeFlow(app);
    res.render("code_flow", { routes });
});

/**
 * Save agent instructions
 */
app.post("/:repoName/chat/:chatNumber/save_agent_instructions", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const { agentInstructions } = req.body;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }
    chatData.agentInstructions = agentInstructions;
    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);
    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * Save state
 */
app.post("/:repoName/chat/:chatNumber/save_state", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const { stateName, attachedFiles } = req.body;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }
    let attachedFilesArray = [];
    try {
        attachedFilesArray = JSON.parse(attachedFiles);
    } catch (err) {
        console.error("[ERROR] parse attachedFiles:", err);
    }
    chatData.savedStates = chatData.savedStates || {};
    chatData.savedStates[stateName] = { attachedFiles: attachedFilesArray };
    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);
    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * Load state
 */
app.post("/:repoName/chat/:chatNumber/load_state", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const { stateName } = req.body;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }
    chatData.savedStates = chatData.savedStates || {};
    if (!chatData.savedStates[stateName]) {
        return res.status(404).send("State not found.");
    }
    chatData.attachedFiles = chatData.savedStates[stateName].attachedFiles;
    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);
    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * Raw messages
 */
app.get("/:repoName/chat/:chatNumber/raw/:messageIndex", (req, res) => {
    const { repoName, chatNumber, messageIndex } = req.params;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }
    if (!chatData.chatHistory || !chatData.chatHistory[messageIndex]) {
        return res.status(404).send("Message not found.");
    }
    const msg = chatData.chatHistory[messageIndex];
    if (msg.role !== "user" || !msg.messagesSent) {
        return res
            .status(404)
            .send("No raw messages available for this message.");
    }
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(msg.messagesSent, null, 2));
});
app.get("/:repoName/chat/:chatNumber/json_viewer/:messageIndex", (req, res) => {
    const { repoName, chatNumber, messageIndex } = req.params;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }
    if (!chatData.chatHistory || !chatData.chatHistory[messageIndex]) {
        return res.status(404).send("Message not found.");
    }
    const msg = chatData.chatHistory[messageIndex];
    if (msg.role !== "user" || !msg.messagesSent) {
        return res
            .status(404)
            .send("No raw messages available for this message.");
    }
    res.render("json_viewer", { messages: msg.messagesSent });
});

/**
 * Return git commit graph in JSON
 */
app.get("/:repoName/git_log", (req, res) => {
    const { repoName } = req.params;
    const repoCfg = loadSingleRepoConfig(repoName);
    if (!repoCfg) {
        return res
            .status(400)
            .json({ error: `Repository '${repoName}' not found.` });
    }
    const gitCommits = getGitCommitGraph(repoCfg.gitRepoLocalPath);
    res.json({ commits: gitCommits });
});

/**
 * Toggle pushAfterCommit
 */
app.post("/:repoName/chat/:chatNumber/toggle_push_after_commit", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }
    chatData.pushAfterCommit = !!req.body.pushAfterCommit;
    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);
    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * Start server
 */
const port = process.env.SERVER_PORT || 3000;
http.createServer(app).listen(port, () => {
    console.log(`[DEBUG] Server running => http://localhost:${port}`);
});

