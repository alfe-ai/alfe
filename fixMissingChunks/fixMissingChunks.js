#!/usr/bin/env node
/**
 * fixMissingChunks.js
 *
 * Now calls an AI API to reconcile missing chunks between original/new file contents.
 *
 * Usage example:
 *   node fixMissingChunks.js --dir=/path/to/project \
 *     --orighash=abc123 --newhash=def456
 *
 * The script automatically retrieves the list of changed files between those two commits
 * and reconciles the missing chunks for each file using AI. After merging, the script writes
 * the merged result back to disk in the specified directory, then performs a git add/commit/push
 * cycle to store the updates.
 *
 * Optional arguments:
 *   --origfile  : Single string contents of old file (skip auto-git retrieval)
 *   --newfile   : Single string contents of new file (skip auto-git retrieval)
 *   --origfilepath : Local file path for old file
 *   --newfilepath : Local file path for new file
 *
 * If none of the file content arguments are specified, the script auto-detects changed files
 * using "git diff --name-only orighash newhash" and then calls "git show orighash:FILE"
 * and "git show newhash:FILE" respectively.
 */

const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(projectRoot, '.env') });

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Calls an AI endpoint to reconcile missing chunks and return the merged file.
 * @param {string} originalFileContent - The original file contents.
 * @param {string} newFileContent - The new file contents.
 * @returns {Promise<string>} - The merged file content from the AI.
 */
async function reconcileMissingChunksUsingAI(originalFileContent, newFileContent) {
  console.log("[DEBUG] reconcileMissingChunksUsingAI => Preparing request to AI API...");
  try {
    const apiKey = process.env.OPENAI_API_KEY || 'your_openai_api_key';
    const model = 'o3'; // updated to use "o3"
    const endpoint = 'https://api.openai.com/v1/chat/completions';

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
    return newFileContent; // fallback
  }
}

/**
 * For a given pair of orighash/newhash, returns an array of changed filenames
 * by running "git diff --name-only".
 * @param {string} repoDir - The path to the repository
 * @param {string} origHash - Old commit hash
 * @param {string} newHash - New commit hash
 */
function getChangedFiles(repoDir, origHash, newHash) {
  console.log(`[DEBUG] getChangedFiles => git diff --name-only ${origHash} ${newHash}`);
  try {
    const diffOutput = execSync(`git diff --name-only ${origHash} ${newHash}`, { cwd: repoDir }).toString().trim();
    if (!diffOutput) {
      console.log("[DEBUG] No changed files detected between the specified commits.");
      return [];
    }
    const files = diffOutput.split('\n').filter(line => line.trim().length > 0);
    return files;
  } catch (e) {
    console.error("[ERROR] Unable to get changed files:", e);
    return [];
  }
}

/**
 * Retrieves file content by using "git show {commitHash}:{filepath}"
 */
function getFileContentFromGit(repoDir, commitHash, filePath) {
  try {
    const cmd = `git show ${commitHash}:${filePath}`;
    const content = execSync(cmd, { cwd: repoDir }).toString();
    return content;
  } catch (err) {
    console.error(`[ERROR] Failed to retrieve file content for ${filePath} at commit ${commitHash}:`, err);
    return "";
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
        describe: 'String contents of the file from prior revision'
      })
      .option('newfile', {
        type: 'string',
        describe: 'String contents of the file from new revision'
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

  console.log("[DEBUG] Parsed arguments:", argv);
  console.log(`[DEBUG] dir => ${argv.dir}`);
  console.log(`[DEBUG] orighash => ${argv.orighash}`);
  console.log(`[DEBUG] newhash => ${argv.newhash}`);

  let origContent = argv.origfile || "";
  let newContent = argv.newfile || "";

  // Possibly read from local files if user specified them
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

  // If we still have no content, automatically gather changed files
  if (!origContent && !newContent) {
    const changedFiles = getChangedFiles(argv.dir, argv.orighash, argv.newhash);
    if (changedFiles.length === 0) {
      console.log("[DEBUG] No files changed or cannot detect changes. Exiting.");
      return;
    }

    console.log(`[DEBUG] Found ${changedFiles.length} changed file(s). Processing each...`);
    const processedFiles = [];

    for (const filePath of changedFiles) {
      console.log(`\n[DEBUG] Processing file => ${filePath}`);
      const oldFileContent = getFileContentFromGit(argv.dir, argv.orighash, filePath);
      const newFileContent = getFileContentFromGit(argv.dir, argv.newhash, filePath);

      if (!oldFileContent && !newFileContent) {
        console.log("[DEBUG] No content for this file; skipping AI call.");
        continue;
      }

      try {
        const mergedContent = await reconcileMissingChunksUsingAI(oldFileContent, newFileContent);

        // Display in console
        console.log(`===== Merged File Output Start: ${filePath} =====`);
        console.log(mergedContent);
        console.log(`===== Merged File Output End: ${filePath} =====`);

        // Write merged content back to disk
        const targetPath = path.join(argv.dir, filePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, mergedContent, 'utf-8');
        processedFiles.push(filePath);

      } catch (err) {
        console.error("[ERROR] Merging failed:", err);
      }
    }

    // If any files were processed, commit and push them
    if (processedFiles.length > 0) {
      try {
        console.log(`[DEBUG] Attempting git commit & push for ${processedFiles.length} file(s) ...`);
        execSync(`git add .`, { cwd: argv.dir, stdio: "inherit" });
        const commitMsg = `Merged missing chunks for files: ${processedFiles.join(', ')}`;
        execSync(`git commit -m "${commitMsg}"`, { cwd: argv.dir, stdio: "inherit" });
        execSync(`git push`, { cwd: argv.dir, stdio: "inherit" });
        console.log("[DEBUG] Git commit and push completed successfully.");
      } catch (err) {
        console.error("[ERROR] Git commit/push failed:", err);
      }
    }

    return;
  }

  // Single-file scenario (for backward compatibility)
  console.log("[DEBUG] Single-file scenario or partial user input. Attempting to reconcile...");

  console.log("[DEBUG] Original content length =>", origContent.length);
  console.log("[DEBUG] New content length      =>", newContent.length);

  if (origContent && newContent) {
    reconcileMissingChunksUsingAI(origContent, newContent)
        .then(mergedContent => {
          console.log("===== Merged File Output Start =====");
          console.log(mergedContent);
          console.log("===== Merged File Output End =====");

          // Write merged content back to disk if user provided a local path
          if (argv.origfilepath && argv.newfilepath) {
            try {
              // We'll assume we apply to the "newfilepath"
              fs.writeFileSync(argv.newfilepath, mergedContent, 'utf-8');
              console.log("[DEBUG] Updated newfilepath with merged content.");

              // Then we can commit/push if user set --dir
              if (argv.dir) {
                const relativePath = path.relative(argv.dir, argv.newfilepath);
                try {
                  execSync(`git add .`, { cwd: argv.dir, stdio: "inherit" });
                  const commitMsg = `Merged missing chunks single-file: ${relativePath}`;
                  execSync(`git commit -m "${commitMsg}"`, { cwd: argv.dir, stdio: "inherit" });
                  execSync(`git push`, { cwd: argv.dir, stdio: "inherit" });
                  console.log("[DEBUG] Git commit and push completed for single-file scenario.");
                } catch (err) {
                  console.error("[ERROR] Git commit/push failed:", err);
                }
              }
            } catch (e) {
              console.error("[ERROR] Failed to write updated content to newfilepath:", e);
            }
          }
        })
        .catch(err => {
          console.error("[ERROR] Merging failed:", err);
        });
  } else {
    console.log("[DEBUG] At least one file content is empty. No merge performed.");
  }
}

main();
