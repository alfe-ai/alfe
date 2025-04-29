const { loadSingleRepoConfig } = require('./executable/server_webserver/server_defs');

const repoNameCLI = 'WhimsicalPuppet';
const repoConfig = loadSingleRepoConfig(repoNameCLI);

if (repoConfig) {
    console.log('Repository configuration loaded successfully:', repoConfig);
} else {
    console.error('Failed to load repository configuration for:', repoNameCLI);
    process.exit(1);
}
