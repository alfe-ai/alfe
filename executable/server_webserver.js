(require("dotenv").config();
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
 * Convert various git clone URLs to an https://github.com/... form suitable
 * for web browsers. Examples:
 *   git@github.com:user/repo.git -> https://github.com/user/repo
 *   https://github.com/user/repo  -> https://github.com/user/repo
 *   ssh://git@github.com/user/repo.git -> https://github.com/user/repo
 * Returns "#" if the input is empty/undefined.
 */
function convertGitUrlToHttps(gitURL) {
    if (!gitURL || gitURL === "#") return "#";

    // Remove ssh prefix variants
    if (gitURL.startsWith("git@github.com:")) {
        gitURL = gitURL.replace("git@github.com:", "https://github.com/");
    } else if (gitURL.startsWith("ssh://git@github.com/")) {
        gitURL = gitURL.replace("ssh://git@github.com/", "https://github.com/");
    }

    // Strip trailing ".git" if present
    if (gitURL.endsWith(".git")) {
        gitURL = gitURL.slice(0, -4);
    }

    // Ensure it starts with https://
    if (!gitURL.startsWith("http://") && !gitURL.startsWith("https://")) {
        gitURL = "https://github.com/" + gitURL.replace(/^github\.com[/:]/, "");
    }

    return gitURL;
}

/**
 * Global Agent Instructions
 */
const GLOBAL_INSTRUCTIONS_PATH = path.join(PROJECT_ROOT, "data", "config", "global_agent_instructions.txt");
... (file content unchanged until the first affected section) ...

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
                    gitRepoURL: convertGitUrlToHttps(repoConfig[repoName].gitRepoURL || "#"),
                });
            }
        }
    }
    res.render("repositories", { repos: repoList });
});

... (unchanged content) ...

    const {
        gitRepoLocalPath,
        gitBranch,
        openAIAccount,
        gitRepoURL,
    } = repoConfig;
    const attachedFiles = chatData.attachedFiles || [];

... (unchanged content) ...

    // GitHub URL from repoConfig (convert SSH -> HTTPS if necessary)
    const githubURL = convertGitUrlToHttps(gitRepoURL || "#");
    const chatGPTURL = chatData.chatURL || "";
    const status = chatData.status || "ACTIVE";

... (rest of file unchanged) ...
