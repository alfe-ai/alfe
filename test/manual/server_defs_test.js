
// test saving 'TestRepo' reponame to local path

const { saveRepoConfig, loadRepoConfig } = require('../../executable/server_webserver/server_defs');

saveRepoConfig('TestRepo', '~/smartgit_prjs/TestRepo');
