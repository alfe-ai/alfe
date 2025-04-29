function setupGetRoutes({
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
                        }) {
    console.log("[DEBUG] Setting up GET routes...");

    // Existing routes...

    /**
     * GET /:repoName/git_branches
     * Returns array of branch names for the specified repository.
     */
    app.get("/:repoName/git_branches", (req, res) => {
        const repoName = req.params.repoName;
        const repoConfig = loadSingleRepoConfig(repoName);

        console.log(`[DEBUG] GET /${repoName}/git_branches => Attempting to list local branches...`);

        if (!repoConfig || !repoConfig.localPath) {
            return res.status(400).json({ error: "Repository config not found." });
        }

        try {
            const { execSync } = require("child_process");
            const result = execSync("git branch --list --no-color", {
                cwd: repoConfig.localPath,
            })
                .toString()
                .trim();

            /*
              The output typically looks like:
              * main
                feature-xyz
                ...
            */
            const branches = result
                .split("\n")
                .map((line) => line.replace(/^(\*|\s)+/, "")) // Remove leading * or spaces
                .filter((b) => b);

            console.log("[DEBUG] Branches found:", branches);
            return res.json(branches);
        } catch (err) {
            console.error("[ERROR] listing branches:", err);
            return res.status(500).json({ error: "Failed to list branches." });
        }
    });

    // Additional GET routes...
}

module.exports = { setupGetRoutes };