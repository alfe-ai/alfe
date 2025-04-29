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
 * Convert a git URL (SSH / HTTPS) to clean HTTPS form for browser links.
 * Examples:
 *   git@github.com:user/repo.git  -> https://github.com/user/repo
 *   https://github.com/user/repo.git -> https://github.com/user/repo
 * @param {string} url
 * @returns {string}
 */
function convertGitUrlToHttps(url) {
    if (!url) return "#";

    // SSH form
    if (url.startsWith("git@github.com:")) {
        let repo = url.slice("git@github.com:".length);
        if (repo.endsWith(".git")) repo = repo.slice(0, -4);
        return `https://github.com/${repo}`;
    }

    // HTTPS form – strip trailing .git if present
    if (url.startsWith("https://github.com/") && url.endsWith(".git")) {
        return url.slice(0, -4);
    }

    return url;
}

/**
 * Global Agent Instructions
 */
const GLOBAL_INSTRUCTIONS_PATH = path.join(PROJECT_ROOT, "data", "config", "global_agent_instructions.txt");
...
    // GitHub URL from repoConfig (converted to https for browser)
    const githubURL = convertGitUrlToHttps(gitRepoURL);
...
