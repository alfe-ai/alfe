const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Import helpers for loading/saving the repo JSON
const {
  loadRepoJson,
  saveRepoJson,
  loadSingleRepoConfig
} = require('../../../server_defs');

// Default model
const DEFAULT_AIMODEL = 'o3';

/**
 * Provide a function to read global agent instructions from disk
 */
function loadGlobalInstructions() {
  console.log('[DEBUG] loadGlobalInstructions() => invoked in api_connector.');
  try {
    const PROJECT_ROOT = path.resolve(__dirname, '../../../');
    console.log(`[DEBUG] Using PROJECT_ROOT => ${PROJECT_ROOT}`);
    const GLOBAL_INSTRUCTIONS_PATH = path.join(
        PROJECT_ROOT,
        'data',
        'config',
        'global_agent_instructions.txt'
    );
    console.log(`[DEBUG] loadGlobalInstructions => Checking for file at: ${GLOBAL_INSTRUCTIONS_PATH}`);
    if (!fs.existsSync(GLOBAL_INSTRUCTIONS_PATH)) {
      console.log('[DEBUG] global_agent_instructions.txt not found => returning empty string.');
      return '';
    }
    const instructions = fs.readFileSync(GLOBAL_INSTRUCTIONS_PATH, 'utf-8');
    console.log(`[DEBUG] loadGlobalInstructions => read file successfully, length: ${instructions.length}`);
    return instructions;
  } catch (e) {
    console.error('[ERROR] reading global_agent_instructions:', e);
    return '';
  }
}

/**
 * Builds a directory tree structure as an object, skipping hidden files and those in an excluded set.
 * @param {string} dirPath
 * @param {string} rootDir
 * @param {string[]} attachedFiles
 * @returns {Object} Directory tree with children.
 */
function buildFileTree(dirPath, rootDir, attachedFiles) {
  const excludedFilenames = new Set();
  if (!fs.existsSync(dirPath)) {
    return { name: path.basename(dirPath), type: 'directory', children: [], path: '', isAttached: false };
  }

  const items = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(item => {
        if (item.name.startsWith('.')) return false;
        if (excludedFilenames.has(item.name)) return false;
        return true;
      })
      .sort((a, b) => {
        // directories first
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

  const children = [];
  for (const item of items) {
    const absolutePath = path.join(dirPath, item.name);
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const isDir = item.isDirectory();

    if (isDir) {
      children.push(buildFileTree(absolutePath, rootDir, attachedFiles));
    } else {
      children.push({
        name: item.name,
        path: relativePath,
        type: 'file',
        isAttached: attachedFiles.includes(relativePath),
        children: []
      });
    }
  }

  return {
    name: path.basename(dirPath),
    path: path.relative(rootDir, dirPath).split(path.sep).join('/'),
    type: 'directory',
    isAttached: false,
    children
  };
}

/**
 * POST /createChat
 * Creates a new chat for a specified repoName.
 */
router.post('/createChat', (req, res) => {
  console.log('[DEBUG] POST /createChat => Attempting to create chat for repo.');

  const { repoName } = req.body;
  if (!repoName) {
    console.log('[DEBUG] repoName not provided => returning error.');
    return res.status(400).json({ error: 'repoName is required.' });
  }

  // Load the existing data for this repo
  let dataObj = loadRepoJson(repoName);

  if (!dataObj) {
    console.log('[DEBUG] No data object found => initializing empty repo JSON.');
    dataObj = {};
  }

  // Find the highest existing chat number
  let maxChatNumber = 0;
  for (const key of Object.keys(dataObj)) {
    const n = parseInt(key, 10);
    if (!isNaN(n) && n > maxChatNumber) {
      maxChatNumber = n;
    }
  }

  // Load global agent instructions
  const globalInstructions = loadGlobalInstructions();

  // Create a new chat entry
  const newChatNumber = maxChatNumber + 1;
  dataObj[newChatNumber] = {
    status: 'ACTIVE',
    agentInstructions: globalInstructions,
    attachedFiles: [],
    chatHistory: [],
    aiProvider: 'openai',
    aiModel: DEFAULT_AIMODEL,
    pushAfterCommit: true
  };

  // Save
  saveRepoJson(repoName, dataObj);

  console.log('[DEBUG] Created new chat:', newChatNumber, 'for repo:', repoName);
  return res.json({
    success: true,
    repoName,
    newChatNumber,
    status: 'ACTIVE'
  });
});

/**
 * Existing sample: Creates a new chat generically.
 * (For demonstration, retained but not necessarily used.)
 */
router.post('/createGenericChat', (req, res) => {
  console.log('[DEBUG] POST /createGenericChat => creating a generic chat');

  // For demonstration
  const chatData = {
    chatId: Math.floor(Math.random() * 100000),
    status: 'ACTIVE',
    message: req.body.message || 'No message provided',
    createdAt: new Date().toISOString()
  };

  console.log('[DEBUG] New chatData =>', chatData);
  return res.json({
    success: true,
    data: chatData
  });
});

/**
 * GET /listFileTree/:repoName/:chatNumber
 * Returns JSON structure of the file tree for a specified repository/chat.
 */
router.get('/listFileTree/:repoName/:chatNumber', (req, res) => {
  const { repoName, chatNumber } = req.params;
  // Load repo config to find local path
  const repoConfig = loadSingleRepoConfig(repoName);
  if (!repoConfig) {
    console.log('[DEBUG] /listFileTree => Repo config not found:', repoName);
    return res.status(400).json({ error: `Repo '${repoName}' not found.` });
  }

  const dataObj = loadRepoJson(repoName);
  const chatData = dataObj[chatNumber];
  if (!chatData) {
    console.log('[DEBUG] /listFileTree => Chat not found:', chatNumber);
    return res.status(404).json({ error: `Chat #${chatNumber} not found in repo '${repoName}'.` });
  }

  const attachedFiles = chatData.attachedFiles || [];
  const { gitRepoLocalPath } = repoConfig;

  // Build the directory tree
  const tree = buildFileTree(gitRepoLocalPath, gitRepoLocalPath, attachedFiles);
  return res.json({ success: true, tree });
});

/**
 * POST /changeBranchOfChat/:repoName/:chatNumber
 * Switches the repository branch for the specified chat
 * and stores the new branch name in chat data as chatData.gitBranch.
 */
router.post('/changeBranchOfChat/:repoName/:chatNumber', (req, res) => {
  const { repoName, chatNumber } = req.params;
  const { createNew, branchName, newBranchName } = req.body || {};

  const repoCfg = loadSingleRepoConfig(repoName);
  if (!repoCfg) {
    return res.status(400).json({ error: `Repo '${repoName}' not found.` });
  }

  const dataObj = loadRepoJson(repoName);
  const chatData = dataObj[chatNumber];
  if (!chatData) {
    return res.status(404).json({ error: `Chat #${chatNumber} not found in repo '${repoName}'.` });
  }

  const { gitRepoLocalPath } = repoCfg;
  const { execSync } = require('child_process');

  try {
    if (createNew === true || createNew === 'true') {
      if (!newBranchName) {
        return res.status(400).json({ error: "No new branch name provided." });
      }
      execSync(`git checkout -b "${newBranchName}"`, { cwd: gitRepoLocalPath, stdio: "pipe" });
      repoCfg.gitBranch = newBranchName;
      chatData.gitBranch = newBranchName;
    } else {
      if (!branchName) {
        return res.status(400).json({ error: "No branch name provided." });
      }
      execSync(`git checkout "${branchName}"`, { cwd: gitRepoLocalPath, stdio: "pipe" });
      repoCfg.gitBranch = branchName;
      chatData.gitBranch = branchName;
    }

    // Save updated repo config
    const { loadRepoConfig, saveRepoConfig } = require('../../../server_defs');
    const allConfig = loadRepoConfig() || {};
    allConfig[repoName] = repoCfg;
    saveRepoConfig(allConfig);

    // Save updated chat data
    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);

    return res.json({ success: true, newBranch: chatData.gitBranch });
  } catch (err) {
    console.error("[ERROR] changeBranchOfChat =>", err);
    return res.status(500).json({ error: "Failed to switch branch." });
  }
});

module.exports = router;