const express = require('express');
const cors = require('cors');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai'); // Added for AI integration

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
 * Checks whether the given file path is attached. Supports both "relativePath"
 * and "repoName|relativePath" formats.
 * @param {string[]} attachedFiles
 * @param {string} relativePath
 * @returns {boolean}
 */
function isPathAttached(attachedFiles, relativePath) {
  return attachedFiles.some(af => {
    const splitted = af.split('|');
    if (splitted.length === 2) {
      return splitted[1] === relativePath;
    } else {
      return af === relativePath;
    }
  });
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
        isAttached: isPathAttached(attachedFiles, relativePath),
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

// Enable CORS on this router to ensure valid response headers
router.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS','HEAD'],
  allowedHeaders: ['Content-Type','Authorization','Accept','X-Requested-With','Origin']
}));
router.options('*', cors());

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

/* ---------- toggle file attachment ---------- */
router.post("/:repoName/chat/:chatNumber/toggle_attached", (req, res) => {
    const { repoName, chatNumber } = req.params;
    const { filePath } = req.body;
    if (!filePath) {
        return res.status(400).json({ error: "No filePath provided." });
    }

    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
        return res.status(404).json({
            error: `Chat #${chatNumber} not found in repo '${repoName}'.`,
        });
    }

    chatData.attachedFiles = chatData.attachedFiles || [];
    const index = chatData.attachedFiles.indexOf(filePath);

    if (index >= 0) {
        // Remove from attached
        chatData.attachedFiles.splice(index, 1);
    } else {
        // Add to attached
        chatData.attachedFiles.push(filePath);
    }

    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);

    return res.json({
        success: true,
        attachedFiles: chatData.attachedFiles,
    });
});

/**
 * POST /submitNewChatInput
 * Allows the user to submit a new user message for a given repo/chat
 * and returns the AI's full response.
 */
router.post('/submitNewChatInput', async (req, res) => {
  try {
    const { repoName, chatNumber, userMessage } = req.body;

    if (!repoName || !chatNumber || !userMessage) {
      return res.status(400).json({ error: 'repoName, chatNumber, and userMessage are required.' });
    }

    // Load the chat data
    const dataObj = loadRepoJson(repoName);
    const chatData = dataObj[chatNumber];
    if (!chatData) {
      return res.status(404).json({ error: `Chat #${chatNumber} not found in repo '${repoName}'.` });
    }

    // Prepare the client
    const openAiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
      dangerouslyAllowBrowser: true
    });

    // Use configured model or fallback
    const chosenModel = chatData.aiModel || DEFAULT_AIMODEL;
    // Build messages
    const messages = [];

    // If we have agent instructions, add them first
    if (chatData.agentInstructions) {
      messages.push({ role: 'system', content: chatData.agentInstructions });
    }

    // Then user message
    messages.push({ role: 'user', content: userMessage });

    console.log('[DEBUG] Sending to AI => model:', chosenModel, ', total messages:', messages.length);

    // Call the AI
    const response = await openAiClient.chat.completions.create({
      model: chosenModel,
      messages
    });

    const assistantReply = response.choices?.[0]?.message?.content || '';
    console.log('[DEBUG] AI Reply length =>', assistantReply.length);

    // Store in chat history
    chatData.chatHistory = chatData.chatHistory || [];
    chatData.chatHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });
    chatData.chatHistory.push({
      role: 'assistant',
      content: assistantReply,
      timestamp: new Date().toISOString()
    });

    dataObj[chatNumber] = chatData;
    saveRepoJson(repoName, dataObj);

    return res.json({
      success: true,
      assistantReply,
      fullAIResponse: response // Return entire response if needed
    });
  } catch (error) {
    console.error('[ERROR] /submitNewChatInput =>', error);
    return res.status(500).json({ error: 'An error occurred while processing the request.' });
  }
});

module.exports = router;
