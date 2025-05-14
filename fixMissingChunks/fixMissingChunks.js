#!/usr/bin/env node
/**
 * fixMissingChunks.js
 *
 * Now calls an AI API to reconcile missing chunks between original/new file contents.
 *
 * Usage example:
 *   node fixMissingChunks.js --dir=/path/to/project \
 *     --orighash=abc123 --newhash=def456 \
 *     --origfile="previous file contents" \
 *     --newfile="new file contents"
 *
 * Optional arguments:
 *   --origfilepath=/path/to/priorfile
 *   --newfilepath=/path/to/currentfile
 */

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const axios = require('axios');
const fs = require('fs');

/**
 * Calls an AI endpoint to reconcile missing chunks and return the merged file.
 * @param {string} originalFileContent - The original file contents.
 * @param {string} newFileContent - The new file contents.
 * @returns {Promise<string>} - The merged file content from the AI.
 */
async function reconcileMissingChunksUsingAI(originalFileContent, newFileContent) {
  console.log("[DEBUG] reconcileMissingChunksUsingAI => Preparing request to AI API...");
  // Example placeholder for how you'd call your AI
  try {
    const apiKey = process.env.OPENAI_API_KEY || 'your_openai_api_key';
    const model = 'gpt-4'; // or whichever model you prefer
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    // Construct prompt
    const userPrompt = `
We have two file versions:
Original:\n${originalFileContent}\n
New:\n${newFileContent}\n

Please provide the full new file with any missing chunks from the original re-added, merging them appropriately.
`;

    const response = await axios.post(
      endpoint,
      {
        model,
        messages: [{ role: "user", content: userPrompt }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    const aiReply = response.data.choices[0].message.content || "";
    console.log("[DEBUG] AI response received, returning merged content.");
    return aiReply.trim();

  } catch (error) {
    console.error("[ERROR] AI API call failed:", error.message);
    return newFileContent; // fallback to provided new file
  }
}

async function main() {
  console.log("[DEBUG] fixMissingChunks.js => Starting script with verbose output...");

  const argv = yargs(hideBin(process.argv))
    .option('dir', {
      type: 'string',
      describe: 'Path to project directory to operate on',
      demandOption: true
    })
    .option('orighash', {
      type: 'string',
      describe: 'Prior revision hash',
      demandOption: true
    })
    .option('newhash', {
      type: 'string',
      describe: 'New revision hash',
      demandOption: true
    })
    .option('origfile', {
      type: 'string',
      describe: 'String contents of file from prior revision'
    })
    .option('newfile', {
      type: 'string',
      describe: 'String contents of file from new revision'
    })
    .option('origfilepath', {
      type: 'string',
      describe: 'Path to the file from prior revision (optional)'
    })
    .option('newfilepath', {
      type: 'string',
      describe: 'Path to the file from new revision (optional)'
    })
    .help()
    .argv;

  // Print debug info
  console.log("[DEBUG] Parsed arguments:", argv);
  console.log(`[DEBUG] dir => ${argv.dir}`);
  console.log(`[DEBUG] orighash => ${argv.orighash}`);
  console.log(`[DEBUG] newhash  => ${argv.newhash}`);

  // Original and new file contents from argv
  let origContent = argv.origfile || "";
  let newContent = argv.newfile || "";

  // If file-based arguments exist, read them if string-based contents are empty
  if (!origContent && argv.origfilepath) {
    try {
      origContent = fs.readFileSync(argv.origfilepath, "utf-8");
    } catch (e) {
      console.error("[ERROR] Unable to read origfilepath:", e);
    }
  }
  if (!newContent && argv.newfilepath) {
    try {
      newContent = fs.readFileSync(argv.newfilepath, "utf-8");
    } catch (e) {
      console.error("[ERROR] Unable to read newfilepath:", e);
    }
  }

  console.log("[DEBUG] Original content length =>", origContent.length);
  console.log("[DEBUG] New content length      =>", newContent.length);

  // Ask AI to fix missing chunks
  if (origContent && newContent) {
    reconcileMissingChunksUsingAI(origContent, newContent)
      .then(mergedContent => {
        console.log("===== Merged File Output Start =====");
        console.log(mergedContent);
        console.log("===== Merged File Output End =====");
      })
      .catch(err => {
        console.error("[ERROR] Merging failed:", err);
      });
  } else {
    console.log("[DEBUG] One or both file contents are empty. No merge performed.");
  }
}

main();
