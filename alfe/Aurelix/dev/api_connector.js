const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Import helpers for loading/saving the repo JSON
const {
  loadRepoJson,
  saveRepoJson
} = require('../../../server_defs');

// Default model
const DEFAULT_AIMODEL = 'o3';

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

  // Create a new chat entry
  const newChatNumber = maxChatNumber + 1;
  dataObj[newChatNumber] = {
    status: 'ACTIVE',
    agentInstructions: '',    // default or can be set here
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

module.exports = router;
