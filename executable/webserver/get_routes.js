/**
 * Root
 */
const {loadRepoConfig, loadSingleRepoConfig} = require("../../server_defs");
const {analyzeProject} = require("../directory_analyzer");
const {execSync} = require("child_process");
const {analyzeCodeFlow} = require("../code_flow_analyzer");

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
 * Code flow
 */
app.get("/code_flow", (req, res) => {
    const routes = analyzeCodeFlow(app);
    res.render("code_flow", { routes });
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