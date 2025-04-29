import os from "os";
import path from "path";
import fs from "fs";
import {loadRepoConfig, saveRepoConfig} from "../../server_defs";

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
 * Global instructions
 */
app.post("/save_global_instructions", (req, res) => {
    const { globalInstructions } = req.body || {};
    saveGlobalInstructions(globalInstructions || "");
    res.redirect("/global_instructions");
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