const { execSync } = require("child_process");

function setupPostRoutes({
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
                         }) {
    console.log("[DEBUG] Setting up POST routes...");

    // Existing POST routes here...

    /**
     * POST /:repoName/git_switch_branch
     * Checks out selected branch or creates a new one, then saves config.
     */
    app.post("/:repoName/git_switch_branch", (req, res) => {
        const { repoName } = req.params;
        const { branch, createNew } = req.body;

        console.log("[DEBUG] Received request to switch branch =>", { repoName, branch, createNew });

        const repoConfig = loadSingleRepoConfig(repoName);
        if (!repoConfig || !repoConfig.localPath) {
            return res.status(400).json({ success: false, error: "Repository config not found." });
        }

        try {
            // If createNew is true, create a new branch
            if (createNew) {
                console.log(`[DEBUG] Creating new branch '${branch}'.`);
                execSync(`git checkout -b "${branch}"`, { cwd: repoConfig.localPath, stdio: "pipe" });
            } else {
                console.log(`[DEBUG] Switching to existing branch '${branch}'.`);
                execSync(`git checkout "${branch}"`, { cwd: repoConfig.localPath, stdio: "pipe" });
            }

            // Update the branch in the main config
            const allConfig = loadRepoConfig();
            if (!allConfig[repoName]) {
                allConfig[repoName] = {};
            }
            allConfig[repoName].branch = branch;
            saveRepoConfig(allConfig);

            return res.json({ success: true });
        } catch (err) {
            console.error("[ERROR] Switch branch failed =>", err);
            return res.status(500).json({ success: false, error: err.message });
        }
    });
}

module.exports = { setupPostRoutes };