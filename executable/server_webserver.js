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

/**
 * Retrieve git metadata
 */
function getGitMetaData(repoPath) {
    let rev = "";
    let dateStr = "";
    let branchName = "";
    try {
        rev = execSync("git rev-parse HEAD", { cwd: repoPath, stdio: "pipe" })
            .toString()
            .trim();
        dateStr = execSync("git show -s --format=%ci HEAD", {
            cwd: repoPath,
            stdio: "pipe",
        })
            .toString()
            .trim();
        branchName = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: repoPath,
            stdio: "pipe",
        })
            .toString()
            .trim();
    } catch (err) {
        console.error("[ERROR] getGitMetaData =>", err);
    }
    return { rev, dateStr, branchName };
}

/**
 * Get Git commits
 */
function getGitCommits(repoPath) {
    try {
        const gitLog = execSync('git log --pretty=format:"%h - %an, %ar : %s"', {
            cwd: repoPath,
            maxBuffer: 1024 * 1024,
        }).toString();
        const commits = gitLog.split("\n");
        return commits;
    } catch (err) {
        console.error("[ERROR] getGitCommits =>", err);
        return [];
    }
}

/**
 * Get Git commit graph with parent commits
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

        const commits = gitLog.split("\n").map((line) => {
            const [hash, parents, author, date, message] = line.split("\t");
            return {
                hash,
                parents: parents ? parents.split(" ") : [],
                author,
                date,
                message,
            };
        });

        return commits;
    } catch (err) {
        console.error("[ERROR] getGitCommitGraph =>", err);
        return [];
    }
}

/**
 * Performs a git pull in the specified repository path.
 * @param {string} repoPath - The path to the local git repository.
 * @returns {Promise<string>}
 */
function gitUpdatePull(repoPath) {
    return new Promise((resolve, reject) => {
        exec(`git pull`, { cwd: repoPath }, (err, stdout, stderr) => {
            if (err) {
                console.error("[ERROR] git pull failed =>", stderr);
                reject(stderr);
            } else {
                console.log("[DEBUG] git pull success =>", stdout);
                resolve(stdout);
            }
        });
    });
}

/**
 * generateDirectoryTree
 * - skip hidden + EXCLUDED_FILENAMES
 * - directories first, then files
 */
function generateDirectoryTree(dirPath, rootDir, repoName, attachedFiles) {
    console.log("[DEBUG] generateDirectoryTree => scanning folder:", dirPath);

    let html = "<ul>";
    if (!fs.existsSync(dirPath)) {
        console.warn("[DEBUG] Directory not found =>", dirPath);
        return `<p>[Directory not found: ${dirPath}]</p>`;
    }

    let items = fs.readdirSync(dirPath, { withFileTypes: true });
    console.log(
        "[DEBUG] Items in =>",
        dirPath,
        "are =>",
        items.map((i) => i.name)
    );

    // Filter hidden + excluded
    items = items.filter((item) => {
        if (item.name.startsWith(".")) {
            console.log("[DEBUG] SKIP hidden =>", item.name);
            return false;
        }
        if (EXCLUDED_FILENAMES.has(item.name)) {
            console.log("[DEBUG] SKIP excluded =>", item.name);
            return false;
        }
        return true;
    });

    // Sort: directories first, then files
    items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    console.log("[DEBUG] AFTER SORT =>", items.map((i) => i.name));

    for (const item of items) {
        const absolutePath = path.join(dirPath, item.name);
        let breakout = false;
        let stat = null;
        try {
            stat = fs.statSync(absolutePath);
        } catch (e) {
            console.error(`Error: ${e}`);
            breakout = true;
        }

        if (breakout) {
            console.log('breakout = true, continuing.');
            continue;
        }

        // relative path from top-level rootDir
        const relativePath = path
            .relative(rootDir, absolutePath)
            .split(path.sep)
            .join("/");

        if (!stat) {
            console.log('!stat, continuing.');
            continue;
        }

        if (stat.isDirectory()) {
            console.log(
                "[DEBUG] generating directory =>",
                item.name,
                "with relativePath =>",
                relativePath
            );
            html += `
                        <li class="folder collapsed">
                          <span class="tree-label">${item.name}</span>
                          ${generateDirectoryTree(
                              absolutePath,
                              rootDir,
                              repoName,
                              attachedFiles
                          )}
                        </li>
                      `;
        } else {
            const isAttached = attachedFiles.includes(relativePath);
            const selectedClass = isAttached ? "selected-file" : "";
            console.log(
                "[DEBUG] generating file =>",
                item.name,
                "relPath =>",
                relativePath,
                "attached?",
                isAttached
            );

            html += `
                        <li>
                          <span class="file-item ${selectedClass}"
                                data-repo="${repoName}"
                                data-path="${relativePath}">
                            ${item.name}
                          </span>
                        </li>
                      `;
        }
    }

    html += "</ul>";
    return html;
}

/**
 * generateFullDirectoryTree => show entire gitRepoLocalPath
 */
function generateFullDirectoryTree(
    gitRepoLocalPath,
    repoName,
    attachedFiles
) {
    console.log(
        "[DEBUG] generateFullDirectoryTree => scanning from root:",
        gitRepoLocalPath
    );
    return generateDirectoryTree(
        gitRepoLocalPath,
        gitRepoLocalPath,
        repoName,
        attachedFiles
    );
}

/**
 * JSON helpers
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
        console.error("[ERROR] Parsing JSON =>", filePath, err);
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
 * Clone if needed
 */
function cloneRepository(repoName, repoURL, callback) {
    const homeDir = os.homedir();
    const cloneBase = path.join(homeDir, ".fayra", "Whimsical", "git");
    const clonePath = path.join(cloneBase, repoName);

    if (!fs.existsSync(cloneBase)) fs.mkdirSync(cloneBase, { recursive: true });

    if (fs.existsSync(clonePath)) {
        console.log("[DEBUG] Repo", repoName, "already cloned =>", clonePath);
        return callback(null, clonePath);
    }

    console.log(
        "[DEBUG] Cloning =>",
        repoName,
        "from =>",
        repoURL,
        "to =>",
        clonePath
    );
    exec(`git clone ${repoURL} "${clonePath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error("[ERROR] Cloning =>", repoName, stderr);
            return callback(error, null);
        }
        console.log("[DEBUG] Successfully cloned =>", repoName);
        callback(null, clonePath);
    });
}

/**
 * / => /repositories
 */
app.get("/", (req, res) => {
    res.redirect("/repositories");
});

/**
 * GET => global instructions page
 */
app.get("/global_instructions", (req, res) => {
    const currentGlobal = loadGlobalInstructions();
    res.render("global_instructions", { currentGlobal });
});

/**
 * POST => save global instructions
 */
app.post("/save_global_instructions", (req, res) => {
    const { globalInstructions } = req.body || {};
    saveGlobalInstructions(globalInstructions || "");
    res.redirect("/global_instructions");
});

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
                    gitRepoURL: repoConfig[repoName].gitRepoURL || "#",
                });
            }
        }
    }
    res.render("repositories", { repos: repoList });
});

/**
 * GET /repositories/add => Render form to add new repository
 */
app.get("/repositories/add", (req, res) => {
    res.render("add_repository");
});

/**
 * POST /repositories/add => Handle new repository submission
 */
app.post("/repositories/add", (req, res) => {
    const { repoName, gitRepoURL } = req.body;

    if (!repoName || !gitRepoURL) {
        return res.status(400).send("Repository name and URL are required.");
    }

    // Clone the repository into '~/.fayra/Whimsical/git/<repoName>'
    const homeDir = os.homedir();
    const cloneBase = path.join(homeDir, ".fayra", "Whimsical", "git");
    const clonePath = path.join(cloneBase, repoName);

    if (fs.existsSync(clonePath)) {
        return res.status(400).send("Repository already exists.");
    }

    cloneRepository(repoName, gitRepoURL, (err, clonePath) => {
        if (err) {
            return res.status(500).send("Failed to clone repository.");
        }

        // Update repo_config.json
        const repoConfig = loadRepoConfig() || {};
        repoConfig[repoName] = {
            gitRepoLocalPath: clonePath,
            gitRepoURL: gitRepoURL,
            gitBranch: "main",
            openAIAccount: "",
        };
        saveRepoConfig(repoConfig);

        res.redirect("/repositories");
    });
});

/**
 * Shortcut => /:repoName => /:repoName/chats
 */
app.get("/:repoName", (req, res) => {
    res.redirect(`/${req.params.repoName}/chats`);
});

/**
 * /:repoName/chats => show chats
 */
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

/**
 * GET /:repoName/chat => Create a new chat and redirect to it
 */
app.get("/:repoName/chat", (req, res) => {
    const repoName = req.params.repoName;
    const dataObj = loadRepoJson(repoName);

    // Find the next available chat number
    let maxChatNumber = 0;
    for (const key of Object.keys(dataObj)) {
        const chatNumber = parseInt(key, 10);
        if (!isNaN(chatNumber) && chatNumber > maxChatNumber) {
            maxChatNumber = chatNumber;
        }
    }
    const newChatNumber = maxChatNumber + 1;

    // Pull global instructions
    const defaultGlobals = loadGlobalInstructions();

    // Initialize the new chat data (with pushAfterCommit defaulted to false)
    dataObj[newChatNumber] = {
        status: "ACTIVE",
        agentInstructions: defaultGlobals,
        attachedFiles: [],
        chatHistory: [],
        aiProvider: "openai",
        aiModel: "o3",
        pushAfterCommit: false
    };
    saveRepoJson(repoName, dataObj);

    // Redirect to the new chat
    res.redirect(`/${repoName}/chat/${newChatNumber}`);
});

/**
 * Show a specific chat
 */
app.get("/:repoName/chat/:chatNumber", (req, res) => {
    const repoName = req.params.repoName;
    const chatNumber = req.params.chatNumber;
    console.log("[DEBUG] GET =>", `/${repoName}/chat/${chatNumber}`);

    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }

    const repoConfig = loadSingleRepoConfig(repoName);
    if (!repoConfig) {
        return res
            .status(400)
            .send(`[ERROR] Repo config not found => '${repoName}'`);
    }

    // default model
    if (!chatData.aiModel) {
        chatData.aiModel = "o3";
    } else {
        chatData.aiModel = chatData.aiModel.toLowerCase();
    }

    if (!chatData.aiProvider) {
        chatData.aiProvider = "openai";
    }

    const {
        gitRepoLocalPath,
        gitBranch,
        openAIAccount,
        gitRepoURL,
    } = repoConfig;
    const attachedFiles = chatData.attachedFiles || [];

    // Generate entire tree
    const directoryTreeHTML = generateFullDirectoryTree(
        gitRepoLocalPath,
        repoName,
        attachedFiles
    );

    // Git metadata
    const meta = getGitMetaData(gitRepoLocalPath);

    // Get Git commits
    const gitCommits = getGitCommits(gitRepoLocalPath);

    // Get Git commit graph
    const gitCommitGraph = getGitCommitGraph(gitRepoLocalPath);

    // GitHub URL from repoConfig
    const githubURL = gitRepoURL || "#";
    const chatGPTURL = chatData.chatURL || "";
    const status = chatData.status || "ACTIVE";

    // Generate directory analysis in text mode
    const directoryAnalysisText = analyzeProject(gitRepoLocalPath, {
        plainText: true,
    });

    // Get system information
    const systemInformationText = getSystemInformation();

    // Fetch AI models for the selected provider
    const provider = chatData.aiProvider.toLowerCase();
    const aiModelsForProvider = AIModels[provider] || [];

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
 * Function to get system information using neofetch
 */
function getSystemInformation() {
    let output = "";
    try {
        // Check if neofetch is installed
        execSync("command -v neofetch");
        output = execSync(
            "neofetch --config none --ascii off --color_blocks off --stdout"
        ).toString();
    } catch (error) {
        console.error("[ERROR] getSystemInformation =>", error);
        output = "[neofetch not available]";
    }
    return output;
}

/**
 * POST => set chat model and provider
 */
app.post("/set_chat_model", (req, res) => {
    const { gitRepoNameCLI, chatNumber, aiModel, aiProvider } = req.body;
    console.log("[DEBUG] POST => /set_chat_model =>", aiModel, aiProvider);

    const dataObj = loadRepoJson(gitRepoNameCLI);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res
            .status(404)
            .send(`Chat #${chatNumber} not found => repo '${gitRepoNameCLI}'`);
    }

    chatData.aiModel = aiModel;
    chatData.aiProvider = aiProvider;
    dataObj[chatNumber] = chatData;
    saveRepoJson(gitRepoNameCLI, dataObj);

    // Fetch models for the new provider if not already fetched
    const provider = aiProvider.toLowerCase();
    if (!AIModels[provider]) {
        fetchAndSortModels(provider);
    }

    return res.redirect(`/${gitRepoNameCLI}/chat/${chatNumber}`);
});

/**
 * POST => handle chat messages
 */
app.post(
    "/:repoName/chat/:chatNumber",
    upload.array("imageFiles"),
    async (req, res) => {
        try {
            const repoName = req.params.repoName;
            const chatNumber = req.params.chatNumber;
            console.log(
                "[DEBUG] POST => /",
                repoName,
                "/chat/",
                chatNumber,
                "body =>",
                req.body
            );

            let userMessage = req.body.message || req.body.chatInput;
            if (!userMessage) {
                return res.status(400).json({ error: "No message provided" });
            }

            const dataObj = loadRepoJson(repoName);
            const chatData = dataObj[chatNumber];
            if (!chatData) {
                return res.status(404).json({
                    error: `Chat #${chatNumber} not found => repo '${repoName}'`,
                });
            }

            // Update attached files from form if provided
            if (req.body.attachedFiles) {
                try {
                    const parsed = JSON.parse(req.body.attachedFiles);
                    chatData.attachedFiles = parsed;
                    console.log("[DEBUG] Overwrite attachedFiles =>", parsed);
                } catch (err) {
                    console.error("[ERROR] parsing attachedFiles =>", err);
                }
            }

            chatData.aiModel = (
                chatData.aiModel || "o3"
            ).toLowerCase();

            chatData.aiProvider = chatData.aiProvider || "openai";

            const repoConfig = loadSingleRepoConfig(repoName);
            if (!repoConfig) {
                return res.status(400).json({ error: "No repoConfig found." });
            }
            const { gitRepoLocalPath } = repoConfig;
            const attachedFiles = chatData.attachedFiles || [];

            // Perform git update/pull before reading attached files
            await gitUpdatePull(gitRepoLocalPath);

            // Append file contents to userMessage with git revision and timestamp
            for (const filePath of attachedFiles) {
                const absoluteFilePath = path.join(gitRepoLocalPath, filePath);
                if (fs.existsSync(absoluteFilePath)) {
                    const fileContents = fs.readFileSync(
                        absoluteFilePath,
                        "utf-8"
                    );
                    userMessage += `\n\n===== Start of file: ${filePath} =====\n`;
                    userMessage += `${fileContents}\n`;
                    userMessage += `===== End of file: ${filePath} =====\n`;
                } else {
                    userMessage += `\n\n[File not found: ${filePath}]\n`;
                }
            }

            // Handle uploaded image files
            if (req.files && req.files.length > 0) {
                chatData.uploadedImages = chatData.uploadedImages || [];
                req.files.forEach((file) => {
                    const relativePath = path.relative(PROJECT_ROOT, file.path);
                    chatData.uploadedImages.push(relativePath);
                    console.log(
                        `[DEBUG] Uploaded image file saved: ${relativePath}`
                    );
                });
                userMessage += `\n\nUser uploaded ${req.files.length} image(s).`;
            }

            // Build messages for OpenAI
            const messages = [];

            if (chatData.agentInstructions) {
                messages.push({
                    role: "user",
                    content: chatData.agentInstructions,
                });
            }

            messages.push({ role: "user", content: userMessage });
            console.log("[DEBUG] Full prompt =>", JSON.stringify(messages, null, 2));

            // Store messages sent to OpenAI
            chatData.lastMessagesSent = messages;
            dataObj[chatNumber] = chatData;
            saveRepoJson(repoName, dataObj);

            // Get the appropriate OpenAI client
            const provider = chatData.aiProvider;
            const openaiClient = getOpenAIClient(provider);

            // Call OpenAI to get assistant's reply
            const response = await openaiClient.chat.completions.create({
                model: chatData.aiModel,
                messages,
            });

            const assistantReply = response.choices[0].message.content;

            // Parse the assistant's reply to extract files and commit summary
            const extractedFiles = parseAssistantReplyForFiles(assistantReply);
            const commitSummary = parseAssistantReplyForCommitSummary(
                assistantReply
            );

            if (extractedFiles.length > 0) {
                console.log(
                    "[DEBUG] Extracted files from assistant reply:",
                    extractedFiles.map((f) => f.filename)
                );
            }

            // Write the extracted files to the repository
            for (const file of extractedFiles) {
                const filePath = path.join(gitRepoLocalPath, file.filename);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, file.content, "utf-8");
                console.log(`[DEBUG] Written file to ${filePath}`);
            }

            // Perform git commit with the commit summary
            if (commitSummary) {
                try {
                    // Set git commit username and email
                    execSync('git config user.name "whimsy"', {
                        cwd: gitRepoLocalPath,
                    });
                    execSync('git config user.email "whimsy@sylph.box"', {
                        cwd: gitRepoLocalPath,
                    });

                    execSync("git add .", { cwd: gitRepoLocalPath });
                    execSync(
                        `git commit -m "${commitSummary.replace(/"/g, '\\"')}"`,
                        { cwd: gitRepoLocalPath }
                    );
                    console.log(
                        "[DEBUG] Git commit successful with message:",
                        commitSummary
                    );

                    // Push only if chatData.pushAfterCommit is true
                    if (chatData.pushAfterCommit) {
                        execSync("git push", { cwd: gitRepoLocalPath });
                        console.log("[DEBUG] Git push successful.");
                    } else {
                        console.log("

pushAfterCommit is false. Skipping git push.");
                    }
                } catch (err) {
                    console.error("[ERROR] Git commit/push failed:", err);
                }
            } else {
                console.warn(
                    "[WARN] No commit summary found in assistant reply."
                );
            }

            // Save to chatHistory
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

            // Now generate the summary
            const summaryPrompt = `
Please summarize the following conversation between the user and the assistant.

User message:
${userMessage}

Assistant reply:
${assistantReply}

Summary:
`;

            const summaryMessages = [{ role: "user", content: summaryPrompt }];

            // Use the same OpenAI client for summary
            const summaryResponse = await openaiClient.chat.completions.create({
                model: chatData.aiModel,
                messages: summaryMessages,
            });

            const summaryText = summaryResponse.choices[0].message.content;

            // Save the summary into chatData
            chatData.summaryHistory = chatData.summaryHistory || [];
            chatData.summaryHistory.push({
                role: "assistant",
                content: summaryText,
                timestamp: new Date().toISOString(),
            });

            // Store extracted files discreetly in chat data
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
            console.error(
                "[ERROR] => POST /:repoName/chat/:chatNumber =>",
                error
            );
            return res
                .status(500)
                .json({ error: "Failed to process your message." });
        }
    }
);

/**
 * Function to parse the assistant's reply and extract files
 */
function parseAssistantReplyForFiles(assistantReply) {
    const fileRegex =
        /===== Start of file: (.+?) =====\s*([\s\S]*?)===== End of file: \1 =====/g;
    const files = [];
    let match;
    while ((match = fileRegex.exec(assistantReply)) !== null) {
        console.log("[DEBUG] Matched file:", match[1]);
        const filename = match[1];
        const content = match[2];
        files.push({
            filename,
            content,
        });
    }
    console.log("[DEBUG] Total files extracted:", files.length);
    return files;
}

/**
 * Function to parseAssistantReplyForCommitSummary
 */
function parseAssistantReplyForCommitSummary(assistantReply) {
    const commitSummaryRegex = /A\.\s*Commit Summary\s*([\s\S]*?)B\.\s*Files/;
    const match = assistantReply.match(commitSummaryRegex);
    if (match && match[1]) {
        return match[1].trim();
    }
    return null;
}

/**
 * POST => git update/pull
 */
app.post("/:repoName/git_update", async (req, res) => {
    const repoName = req.params.repoName;
    console.log(`[DEBUG] POST /${repoName}/git_update`);

    const repoConfig = loadSingleRepoConfig(repoName);
    if (!repoConfig) {
        return res
            .status(400)
            .json({ error: `Repository '${repoName}' not found.` });
    }

    const { gitRepoLocalPath } = repoConfig;

    try {
        const pullOutput = await gitUpdatePull(gitRepoLocalPath);

        // Get current commit hash after pulling
        const currentCommit = execSync("git rev-parse HEAD", {
            cwd: gitRepoLocalPath,
        })
            .toString()
            .trim();

        res.json({
            success: true,
            currentCommit,
            pullOutput,
        });
    } catch (error) {
        console.error(`[ERROR] gitUpdatePull for ${repoName} =>`, error);
        res.status(500).json({ error: "Failed to update repository." });
    }
});

/**
 * /code_flow => Show code flow analysis
 */
app.get("/code_flow", (req, res) => {
    const routes = analyzeCodeFlow(app);
    res.render("code_flow", { routes });
});

/**
 * POST => save agent instructions
 */
app.post("/:repoName/chat/:chatNumber/save_agent_instructions", (req, res) => {
    const repoName = req.params.repoName;
    const chatNumber = req.params.chatNumber;
    const { agentInstructions } = req.body;
    console.log(
        `[DEBUG] POST /${repoName}/chat/${chatNumber}/save_agent_instructions`
    );

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
 * POST => save chat state
 */
app.post("/:repoName/chat/:chatNumber/save_state", (req, res) => {
    const repoName = req.params.repoName;
    const chatNumber = req.params.chatNumber;
    const { stateName, attachedFiles } = req.body;
    console.log(
        `[DEBUG] POST /${repoName}/chat/${chatNumber}/save_state =>`,
        stateName
    );

    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }

    // Parse attachedFiles
    let attachedFilesArray = [];
    try {
        attachedFilesArray = JSON.parse(attachedFiles);
    } catch (err) {
        console.error(
            `[ERROR] parsing attachedFiles => ${attachedFiles}`,
            err
        );
    }

    chatData.savedStates = chatData.savedStates || {};
    chatData.savedStates[stateName] = {
        attachedFiles: attachedFilesArray,
    };

    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);

    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * POST => load chat state
 */
app.post("/:repoName/chat/:chatNumber/load_state", (req, res) => {
    const repoName = req.params.repoName;
    const chatNumber = req.params.chatNumber;
    const { stateName } = req.body;
    console.log(
        `[DEBUG] POST /${repoName}/chat/${chatNumber}/load_state =>`,
        stateName
    );

    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }

    chatData.savedStates = chatData.savedStates || {};

    if (!chatData.savedStates[stateName]) {
        return res.status(404).send("State not found.");
    }

    const savedState = chatData.savedStates[stateName];
    chatData.attachedFiles = savedState.attachedFiles;

    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);

    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * GET => Return raw messages sent to OpenAI API for a specific message
 */
app.get("/:repoName/chat/:chatNumber/raw/:messageIndex", (req, res) => {
    const repoName = req.params.repoName;
    const chatNumber = req.params.chatNumber;
    const messageIndex = parseInt(req.params.messageIndex, 10);
    console.log(
        `[DEBUG] GET /${repoName}/chat/${chatNumber}/raw/${messageIndex}`
    );

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

    // Return the raw messages
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(msg.messagesSent, null, 2));
});

/**
 * GET => Return JSON viewer for messages sent to OpenAI API for a specific message
 */
app.get(
    "/:repoName/chat/:chatNumber/json_viewer/:messageIndex",
    (req, res) => {
        const repoName = req.params.repoName;
        const chatNumber = req.params.chatNumber;
        const messageIndex = parseInt(req.params.messageIndex, 10);
        console.log(
            `[DEBUG] GET /${repoName}/chat/${chatNumber}/json_viewer/${messageIndex}`
        );

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

        // Render JSON viewer page
        res.render("json_viewer", { messages: msg.messagesSent });
    }
);

/**
 * GET => Return git commit graph data in JSON format
 */
app.get("/:repoName/git_log", (req, res) => {
    const repoName = req.params.repoName;

    const repoConfig = loadSingleRepoConfig(repoName);
    if (!repoConfig) {
        return res
            .status(400)
            .json({ error: `Repository '${repoName}' not found.` });
    }

    const { gitRepoLocalPath } = repoConfig;

    const gitCommits = getGitCommitGraph(gitRepoLocalPath);

    res.json({ commits: gitCommits });
});

/**
 * POST => toggle pushAfterCommit
 */
app.post("/:repoName/chat/:chatNumber/toggle_push_after_commit", (req, res) => {
    const repoName = req.params.repoName;
    const chatNumber = req.params.chatNumber;
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).send("Chat not found.");
    }

    // If user checked the box, name="pushAfterCommit" => "on"
    chatData.pushAfterCommit = !!req.body.pushAfterCommit;

    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);

    res.redirect(`/${repoName}/chat/${chatNumber}`);
});

/**
 * Start server on specified port
 */
const port = process.env.SERVER_PORT || 3000;
const server = http.createServer(app);
server.listen(port, () => {
    console.log(`[DEBUG] Server running => http://localhost:${port}`);
});
