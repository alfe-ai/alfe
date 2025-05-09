const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Loads the entire repository configuration from repo_config.json.
 * @returns {Object|null} The configuration object or null if not found/error.
 */
function loadRepoConfig() {
    const configPath = path.join(__dirname, 'data', 'config', 'repo_config.json');
    console.log(`🔍 Attempting to load repo_config.json from ${configPath}`);

    if (!fs.existsSync(configPath)) {
        console.error("❌ repo_config.json not found.");
        return null;
    }

    let configData;
    try {
        configData = fs.readFileSync(configPath, "utf-8");
    } catch (readError) {
        console.error(`❌ Error reading repo_config.json: ${readError.message}`);
        return null;
    }

    try {
        const config = JSON.parse(configData);
        console.log("✅ repo_config.json loaded successfully.");
        return config;
    } catch (parseError) {
        console.error(`❌ Error parsing repo_config.json: ${parseError.message}`);
        return null;
    }
}

/**
 * Loads the configuration for a single repository.
 * @param {string} repoName - The name of the repository.
 * @returns {Object|null} The repository configuration or null if not found.
 */
function loadSingleRepoConfig(repoName) {
    console.log(`🔍 Loading configuration for repository: ${repoName}`);
    const config = loadRepoConfig();

    if (config && config[repoName]) {
        console.log(`✅ Configuration found for repository: ${repoName}`);
        return config[repoName];
    }

    console.warn(`⚠️ Configuration not found for repository: ${repoName}`);
    return null;
}

/**
 * Saves the updated repository configuration back to repo_config.json.
 * @param {Object} updatedConfig - The updated configuration object.
 */
function saveRepoConfig(updatedConfig) {
    const configPath = path.join(__dirname, 'data', 'config', 'repo_config.json');
    console.log(`💾 Saving updated repo_config.json to ${configPath}`);

    try {
        fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");
        console.log("✅ repo_config.json updated successfully.");
    } catch (writeError) {
        console.error(`❌ Error writing to repo_config.json: ${writeError.message}`);
    }
}

/**
 * Retrieves git metadata for a specific file.
 * @param {string} filePath - The absolute path to the file.
 * @param {string} repoPath - The path to the git repository.
 * @returns {Object} An object containing the revision and date string.
 */
function getGitFileMetaData(filePath, repoPath) {
    let rev = "";
    let dateStr = "";
    try {
        rev = execSync(`git log -n 1 --pretty=format:%H -- "${filePath}"`, { cwd: repoPath, stdio: "pipe" }).toString().trim();
        dateStr = execSync(`git log -n 1 --pretty=format:%ci -- "${filePath}"`, { cwd: repoPath, stdio: "pipe" }).toString().trim();
    } catch (err) {
        console.error(`[ERROR] getGitFileMetaData for ${filePath} =>`, err);
    }
    return { rev, dateStr };
}

module.exports = { loadRepoConfig, loadSingleRepoConfig, saveRepoConfig, getGitFileMetaData };
