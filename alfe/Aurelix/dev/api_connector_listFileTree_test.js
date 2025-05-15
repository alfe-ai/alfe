/**
 * Test for the "/listFileTree/:repoName/:chatNumber" GET route.
 * Usage:
 *   1) Ensure the server is running on the appropriate port (default 3000/3001 or as set).
 *   2) Run: node api_connector_listFileTree_test.js
 */

const axios = require('axios');

(async () => {
  const baseURL = 'http://localhost:3444/api';

  // Adjust repoName/chatNumber as needed; they must exist locally.
  const repoName = 'alfe-dev_test_repo';
  const chatNumber = 1;

  try {
    console.log('[DEBUG] Testing listFileTree endpoint...');
    const response = await axios.get(`${baseURL}/listFileTree/${repoName}/${chatNumber}`);
    console.log('[DEBUG] Response data:', response.data);
  } catch (error) {
    console.error('[ERROR] Could not retrieve file tree:', error.message);
  }

  console.log('[DEBUG] Test completed.');
})();
