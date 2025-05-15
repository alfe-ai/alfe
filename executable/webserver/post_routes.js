const os = require("os");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

/**
 * setupPostRoutes attaches all POST routes to the Express app.
 * All external helpers, constants and singletons are injected so that
 * post_routes.js has zero hidden dependencies and works after refactor.
 *
 * @param {object} deps – injected dependencies
 */
function setupPostRoutes(deps) {
    const {
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
    } = deps;

    /* ---------- /repositories/add ---------- */
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
                console.error("[ERROR] cloneRepository:", err);
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

    /* ---------- /set_chat_model ---------- */
    app.post("/set_chat_model", (req, res) => {
        const { gitRepoNameCLI, chatNumber, aiModel, aiProvider } = req.body;
        const dataObj = loadRepoJson(gitRepoNameCLI);
        const chatData = dataObj[chatNumber];
        if (!chatData) {
            return res
                .status(404)
                .send(`Chat #${chatNumber} not found in repo '${gitRepoNameCLI}'.`);
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

    /* ---------- Add Other Repo to Chat ---------- */
    app.post("/:repoName/chat/:chatNumber/add_other_repo", (req, res) => {
        const { repoName, chatNumber } = req.params;
        const { otherRepoName } = req.body;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) {
            return res.status(404).send("Chat not found.");
        }

        chatData.additionalRepos = chatData.additionalRepos || [];
        if (otherRepoName && !chatData.additionalRepos.includes(otherRepoName)) {
            chatData.additionalRepos.push(otherRepoName);
        }

        dataObj[chatNumber] = chatData;
        saveRepoJson(repoName, dataObj);
        res.redirect(`/${repoName}/chat/${chatNumber}`);
    });

    /* ---------- /:repoName/chat/:chatNumber ---------- */
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

            /* ----- attachedFiles from hidden field ----- */
            if (req.body.attachedFiles) {
                try {
                    chatData.attachedFiles = JSON.parse(req.body.attachedFiles);
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

            /* ----- git pull first ----- */
            await gitUpdatePull(gitRepoLocalPath);

            /* ----- inject attached files’ contents (multiple repos) into userMessage ----- */
            const attachedFiles = chatData.attachedFiles || [];
            for (const fullPath of attachedFiles) {
                let actualRepo = repoName;
                let relativePath = fullPath;
                const splitted = fullPath.split("|");
                if (splitted.length === 2) {
                    actualRepo = splitted[0];
                    relativePath = splitted[1];
                }

                const rConfig = loadSingleRepoConfig(actualRepo);
                if (!rConfig) {
                    userMessage += `\n\n[Repo not found: ${actualRepo} for file: ${relativePath}]\n`;
                    continue;
                }

                const absFilePath = path.join(rConfig.gitRepoLocalPath, relativePath);
                if (fs.existsSync(absFilePath)) {
                    const fileContents = fs.readFileSync(absFilePath, "utf-8");
                    userMessage += `\n\n===== Start of file: ${relativePath} =====\n`;
                    userMessage += fileContents;
                    userMessage += `\n===== End of file: ${relativePath} =====\n`;
                } else {
                    userMessage += `\n\n[File not found: ${relativePath} in repo ${actualRepo}]\n`;
                }
            }

            /* ----- handle newly-uploaded images ----- */
            if (req.files && req.files.length > 0) {
                chatData.uploadedImages = chatData.uploadedImages || [];
                for (const file of req.files) {
                    const relativePath = path.relative(PROJECT_ROOT, file.path);
                    chatData.uploadedImages.push(relativePath);
                }
                userMessage += `\n\nUser uploaded ${req.files.length} image(s).`;
            }

            /* ----- build messages for OpenAI ----- */
            const messages = [];
            if (chatData.agentInstructions) {
                messages.push({ role: "user", content: chatData.agentInstructions });
            }
            messages.push({ role: "user", content: userMessage });

            chatData.lastMessagesSent = messages;
            dataObj[chatNumber] = chatData;
            saveRepoJson(repoName, dataObj);

            /* ----- OpenAI call ----- */
            const openaiClient = getOpenAIClient(chatData.aiProvider);
            const response = await openaiClient.chat.completions.create({
                model: chatData.aiModel,
                messages,
            });
            const assistantReply = response.choices[0].message.content;

            /* ----- parse assistant output ----- */
            const extractedFiles = parseAssistantReplyForFiles(assistantReply);
            const commitSummary = parseAssistantReplyForCommitSummary(assistantReply);

            /* ----- write files to disk ----- */
            for (const file of extractedFiles) {
                // Default to main repo if not recognized in name
                let actualRepo = repoName;
                let relativePath = file.filename;
                const splitted = file.filename.split("|");
                if (splitted.length === 2) {
                    actualRepo = splitted[0];
                    relativePath = splitted[1];
                }
                const rConfig = loadSingleRepoConfig(actualRepo);
                if (!rConfig) {
                    console.warn("[WARN] Attempted to write file to unknown repo:", actualRepo);
                    continue;
                }
                const outPath = path.join(rConfig.gitRepoLocalPath, relativePath);
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, file.content, "utf-8");
            }

            /* ----- commit/push, if any ----- */
            if (commitSummary) {
                try {
                    const commitUserName = process.env.GIT_COMMIT_USER_NAME || "YOURNAME";
                    const commitUserEmail = process.env.GIT_COMMIT_USER_EMAIL || "YOURNAME@YOURDOMAIN.tld";
                    execSync(`git config user.name "${commitUserName}"`, { cwd: gitRepoLocalPath });
                    execSync(`git config user.email "${commitUserEmail}"`, { cwd: gitRepoLocalPath });
                    execSync("git add .", { cwd: gitRepoLocalPath });
                    execSync(`git commit -m "${commitSummary.replace(/"/g, '\\"')}"`, { cwd: gitRepoLocalPath });
                    if (chatData.pushAfterCommit) {
                        execSync("git push", { cwd: gitRepoLocalPath });
                    }
                } catch (err) {
                    console.error("[ERROR] Git commit/push failed:", err);
                }
            }

            /* ----- maintain chat & summary history ----- */
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

            /* create a small summary */
            const summaryPrompt = `Please summarize the following conversation between the user and the assistant.\n\nUser message:\n${userMessage}\n\nAssistant reply:\n${assistantReply}\n\nSummary:\n`;
            const summaryResponse = await openaiClient.chat.completions.create({
                model: chatData.aiModel,
                messages: [{ role: "user", content: summaryPrompt }],
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

    /* ---------- helper parsers ---------- */
    function parseAssistantReplyForFiles(assistantReply) {
        const fileRegex = /===== Start of file: (.+?) =====\s*([\s\S]*?)===== End of file: \1 =====/g;
        const files = [];
        let match;
        while ((match = fileRegex.exec(assistantReply)) !== null) {
            files.push({ filename: match[1], content: match[2] });
        }
        return files;
    }

    function parseAssistantReplyForCommitSummary(assistantReply) {
        const commitSummaryRegex = /A\.\s*Commit Summary\s*([\s\S]*?)B\.\s*Files/;
        const match = assistantReply.match(commitSummaryRegex);
        return match && match[1] ? match[1].trim() : null;
    }

    /* ---------- /:repoName/git_update ---------- */
    app.post("/:repoName/git_update", async (req, res) => {
        const repoName = req.params.repoName;
        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) {
            return res.status(400).json({ error: `Repo '${repoName}' not found.` });
        }
        try {
            const pullOutput = await gitUpdatePull(repoCfg.gitRepoLocalPath);
            const currentCommit = execSync("git rev-parse HEAD", { cwd: repoCfg.gitRepoLocalPath }).toString().trim();
            res.json({ success: true, currentCommit, pullOutput });
        } catch (err) {
            console.error("[ERROR] gitUpdatePull:", err);
            res.status(500).json({ error: "Failed to update repository." });
        }
    });

    /* ---------- save agent instructions ---------- */
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

    /* ---------- save & load states ---------- */
    app.post("/:repoName/chat/:chatNumber/save_state", (req, res) => {
        const { repoName, chatNumber } = req.params;
        const { stateName, attachedFiles } = req.body;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) return res.status(404).send("Chat not found.");

        let attachedFilesArray = [];
        try { attachedFilesArray = JSON.parse(attachedFiles); } catch (e) { /**/ }

        chatData.savedStates = chatData.savedStates || {};
        chatData.savedStates[stateName] = { attachedFiles: attachedFilesArray };
        dataObj[chatNumber] = chatData;
        saveRepoJson(repoName, dataObj);
        res.redirect(`/${repoName}/chat/${chatNumber}`);
    });

    app.post("/:repoName/chat/:chatNumber/load_state", (req, res) => {
        const { repoName, chatNumber } = req.params;
        const { stateName } = req.body;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) return res.status(404).send("Chat not found.");

        chatData.savedStates = chatData.savedStates || {};
        if (!chatData.savedStates[stateName]) return res.status(404).send("State not found.");

        chatData.attachedFiles = chatData.savedStates[stateName].attachedFiles;
        dataObj[chatNumber] = chatData;
        saveRepoJson(repoName, dataObj);
        res.redirect(`/${repoName}/chat/${chatNumber}`);
    });

    /* ---------- global instructions ---------- */
    app.post("/save_global_instructions", (req, res) => {
        const { globalInstructions } = req.body || {};
        saveGlobalInstructions(globalInstructions || "");
        res.redirect("/global_instructions");
    });

    /* ---------- toggle push-after-commit ---------- */
    app.post("/:repoName/chat/:chatNumber/toggle_push_after_commit", (req, res) => {
        const { repoName, chatNumber } = req.params;
        const dataObj = loadRepoJson(repoName);
        const chatData = dataObj[chatNumber];
        if (!chatData) return res.status(404).send("Chat not found.");

        chatData.pushAfterCommit = !!req.body.pushAfterCommit;
        dataObj[chatNumber] = chatData;
        saveRepoJson(repoName, dataObj);
        res.redirect(`/${repoName}/chat/${chatNumber}`);
    });

    /* ---------- /:repoName/git_switch_branch ---------- */
    app.post("/:repoName/git_switch_branch", (req, res) => {
        const { repoName } = req.params;
        const { createNew, branchName, newBranchName } = req.body || {};
        const repoCfg = loadSingleRepoConfig(repoName);
        if (!repoCfg) {
            return res.status(400).json({ error: `Repo '${repoName}' not found.` });
        }
        const { gitRepoLocalPath } = repoCfg;

        try {
            if (createNew === true || createNew === "true") {
                if (!newBranchName) {
                    return res.status(400).json({ error: "No new branch name provided." });
                }
                execSync(`git checkout -b "${newBranchName}"`, { cwd: gitRepoLocalPath, stdio: "pipe" });
                repoCfg.gitBranch = newBranchName;
            } else {
                if (!branchName) {
                    return res.status(400).json({ error: "No branch name provided." });
                }
                execSync(`git checkout "${branchName}"`, { cwd: gitRepoLocalPath, stdio: "pipe" });
                repoCfg.gitBranch = branchName;
            }
            const allConfig = loadRepoConfig() || {};
            allConfig[repoName] = repoCfg;
            saveRepoConfig(allConfig);

            return res.json({ success: true });
        } catch (err) {
            console.error("[ERROR] gitSwitchBranch =>", err);
            return res.status(500).json({ error: "Failed to switch branch." });
        }
    });
}

module.exports = { setupPostRoutes };
