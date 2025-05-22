/**
 * setupGetRoutes attaches all GET (and some auxiliary) routes to the Express
 * application.  Everything the routes need is injected through the `deps`
 * object so the module has zero hidden dependencies.
 *
 * @param {object} deps – injected dependencies
 */
function setupGetRoutes(deps) {
    const {
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
    } = deps;

    /* ---------- Root ---------- */
    app.get("/", (_req, res) => res.redirect("/repositories"));

    /* ---------- Global instructions ---------- */
    app.get("/global_instructions", (_req, res) => {
        console.log("[DEBUG] GET /global_instructions => calling loadGlobalInstructions...");
        const currentGlobal = loadGlobalInstructions();
        console.log(`[DEBUG] GET /global_instructions => instructions length: ${currentGlobal.length}`);
        res.render("global_instructions", { currentGlobal });
    });

    /* ---------- Repositories listing ---------- */
    app.get("/repositories", (_req, res) => {
        const repoConfig = loadRepoConfig();
        const repoList = [];
        if (repoConfig) {
            for (const repoName in repoConfig) {
                if (Object.prototype.hasOwnProperty.call(repoConfig, repoName)) {
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

    app.get("/repositories/add", (_req, res) => {
        res.render("add_repository");
    });

    /* ---------- Repo helper redirects ---------- */
    app.get("/:repoName", (req, res) => {
        res.redirect(`/${req.params.repoName}/chats`);
    });

    /* ---------- Chats list ---------- */
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

    /* ---------- Create new chat ---------- */
    app.get("/:repoName/chat", (req, res) => {
        const repoName = req.params.repoName;
        const dataObj = loadRepoJson(repoName);

        /* find highest existing chat number */
        let maxChatNumber = 0;
        for (const key of Object.keys(dataObj)) {
            const n = parseInt(key, 10);
            if (!isNaN(n) && n > maxChatNumber) maxChatNumber = n;
        }
        const newChatNumber = maxChatNumber + 1;

        dataObj[newChatNumber] = {
            status: "ACTIVE",
            agentInstructions: loadGlobalInstructions(),
            attachedFiles: [],
            chatHistory: [],
            aiProvider: "openai",
            aiModel: DEFAULT_AIMODEL,
            pushAfterCommit: true,
        };
        saveRepoJson(repoName, dataObj);
        res.redirect(`/${repoName}/chat/${newChatNumber}`);
    });

    /* ---------- Show specific chat ---------- */
    app.get("/:repoName/chat/:chatNumber", (req, res) => {
        const { repoName, chatNumber } = req.params;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) return res.status(404).send("Chat not found.");

        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) return res.status(400).send(`[ERROR] Repo config not found: '${repoName}'`);

        /* defaults */
        chatData.aiModel = (chatData.aiModel || DEFAULT_AIMODEL).toLowerCase();
        chatData.aiProvider = chatData.aiProvider || "openai";
        chatData.additionalRepos = chatData.additionalRepos || [];

        const {
            gitRepoLocalPath,
            gitBranch,
            openAIAccount,
            gitRepoURL,
        } = repoCfg;

        const attachedFiles = chatData.attachedFiles || [];
        const directoryTreeHTML = generateFullDirectoryTree(gitRepoLocalPath, repoName, attachedFiles.filter(s => !s.includes('|')));

        // Collect additional repos' directory trees
        const additionalReposTrees = [];
        const loadRepoConfiguration = loadRepoConfig() || {};
        for (const otherRepoName of chatData.additionalRepos) {
            const otherRepoCfg = loadSingleRepoConfig(otherRepoName);
            if (otherRepoCfg) {
                // parse out only this repo's attached files
                const filesForThisRepo = attachedFiles
                    .filter(f => f.startsWith(otherRepoName + "|"))
                    .map(f => f.replace(otherRepoName + "|", ""));
                const treeHTML = generateFullDirectoryTree(
                    otherRepoCfg.gitRepoLocalPath,
                    otherRepoName,
                    filesForThisRepo
                );
                additionalReposTrees.push({ repoName: otherRepoName, directoryTreeHTML: treeHTML });
            }
        }

        // For selection in the "Add other repo" form
        const allRepoConfig = loadRepoConfig() || {};
        const allRepoNames = Object.keys(allRepoConfig);
        const possibleReposToAdd = allRepoNames.filter(name => name !== repoName && !chatData.additionalRepos.includes(name));

        const meta            = getGitMetaData(gitRepoLocalPath);
        const gitCommits      = getGitCommits(gitRepoLocalPath);
        const gitCommitGraph  = getGitCommitGraph(gitRepoLocalPath);

        const githubURL       = convertGitUrlToHttps(gitRepoURL);
        const chatGPTURL      = chatData.chatURL || "";
        const status          = chatData.status || "ACTIVE";

        const directoryAnalysisText = analyzeProject(gitRepoLocalPath, { plainText: true });

        /* basic system info via neofetch (optional) */
        function getSystemInformation() {
            let output = "";
            try {
                execSync("command -v neofetch");
                output = execSync("neofetch --config none --ascii off --color_blocks off --stdout").toString();
            } catch {
                output = "[neofetch not available]";
            }
            return output;
        }

        const aiModelsForProvider = AIModels[chatData.aiProvider.toLowerCase()] || [];

        res.render("chat", {
            gitRepoNameCLI : repoName,
            chatNumber,
            directoryTreeHTML,
            additionalReposTrees,
            possibleReposToAdd,
            chatData,
            AIModels        : aiModelsForProvider,
            aiModel         : chatData.aiModel,
            status,
            gitRepoLocalPath,
            githubURL,
            gitBranch,
            openAIAccount,
            chatGPTURL,
            gitRevision     : meta.rev,
            gitTimestamp    : meta.dateStr,
            gitBranchName   : meta.branchName,
            gitTag          : meta.latestTag,
            gitCommits,
            gitCommitGraph,
            directoryAnalysisText,
            systemInformationText : getSystemInformation(),
            environment     : res.locals.environment,
            appCWD          : process.cwd(),
        });
    });

    /* ---------- Code-flow visualiser ---------- */
    app.get("/code_flow", (_req, res) => {
        const routes = analyzeCodeFlow(app);
        res.render("code_flow", { routes });
    });

    /* ---------- Raw / JSON viewer helpers ---------- */
    app.get("/:repoName/chat/:chatNumber/raw/:idx", (req, res) => {
        const { repoName, chatNumber, idx } = req.params;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) return res.status(404).send("Chat not found.");
        if (!chatData.chatHistory || !chatData.chatHistory[idx])
            return res.status(404).send("Message not found.");

        const msg = chatData.chatHistory[idx];
        if (msg.role !== "user" || !msg.messagesSent)
            return res.status(404).send("No raw messages available for this message.");

        res.type("application/json").send(JSON.stringify(msg.messagesSent, null, 2));
    });

    app.get("/:repoName/chat/:chatNumber/json_viewer/:idx", (req, res) => {
        const { repoName, chatNumber, idx } = req.params;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) return res.status(404).send("Chat not found.");
        if (!chatData.chatHistory || !chatData.chatHistory[idx])
            return res.status(404).send("Message not found.");

        const msg = chatData.chatHistory[idx];
        if (msg.role !== "user" || !msg.messagesSent)
            return res.status(404).send("No raw messages available for this message.");

        res.render("json_viewer", { messages: msg.messagesSent });
    });

    /* ---------- Git log (JSON) ---------- */
    app.get("/:repoName/git_log", (req, res) => {
        const { repoName } = req.params;
        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) return res.status(400).json({ error: `Repository '${repoName}' not found.` });

        const gitCommits = getGitCommitGraph(repoCfg.gitRepoLocalPath);
        res.json({ commits: gitCommits });
    });

    /* ---------- /:repoName/git_branches ---------- */
    app.get("/:repoName/git_branches", (req, res) => {
        const { repoName } = req.params;
        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) {
            return res.status(400).json({ error: `Repo '${repoName}' not found.` });
        }
        const { gitRepoLocalPath } = repoCfg;
        let branchData = [];
        try {
            const branchRaw = execSync("git branch --format='%(refname:short)'", { cwd: gitRepoLocalPath })
                .toString()
                .trim()
                .split("\n");
            branchData = branchRaw.map(b => b.replace(/^\*\s*/, ""));
        } catch (err) {
            console.error("[ERROR] getBranches =>", err);
            return res.status(500).json({ error: "Failed to list branches." });
        }
        return res.json({ branches: branchData });
    });

    /* ---------- New fixMissingChunks page ---------- */
    app.get("/:repoName/fixMissingChunks", (req, res) => {
        res.render("fixMissingChunks", {
            repoName: req.params.repoName
        });
    });

    /* ---------- New diff page ---------- */
    app.get("/:repoName/diff", (req, res) => {
        const { repoName } = req.params;
        const { baseRev, compRev } = req.query;
        let diffOutput = "";
        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) {
            return res.status(400).send(`Repository '${repoName}' not found.`);
        }
        const { gitRepoLocalPath } = repoCfg;

        if (baseRev && compRev) {
            try {
                diffOutput = execSync(`git diff ${baseRev} ${compRev}`, {
                    cwd: gitRepoLocalPath,
                    maxBuffer: 1024 * 1024 * 10,
                }).toString();
            } catch (err) {
                diffOutput = `[ERROR] Failed to run git diff ${baseRev} ${compRev}\n\n${err}`;
            }
        }

        res.render("diff", {
            gitRepoNameCLI: repoName,
            baseRev: baseRev || "",
            compRev: compRev || "",
            diffOutput,
            debugMode: !!process.env.DEBUG,
            environment: res.locals.environment
        });
    });
}

module.exports = { setupGetRoutes };