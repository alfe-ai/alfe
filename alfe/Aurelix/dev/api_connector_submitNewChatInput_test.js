/**
 * Manual test for the new "/submitNewChatInput" route in api_connector.js.
 * Usage:
 *   1) Ensure the server (server_webserver.js) is running on port 3444 or your chosen port.
 *   2) Run: node api_connector_submitNewChatInput_test.js
 *   3) Check console for results.
 */

const axios = require('axios');

(async () => {
  const baseURL = 'http://localhost:3444/api';

  // Adjust these as needed
  const repoName = 'alfe-dev_test_repo';
  const chatNumber = 1; // Expects that you already created or have chat #1 in the repo.
  const userMessage = 'Hello from the /submitNewChatInput test!';

  try {
    console.log('[DEBUG] Testing /submitNewChatInput...');
    const response = await axios.post(`${baseURL}/submitNewChatInput`, {
      repoName,
      chatNumber,
      userMessage
    });
    console.log('[DEBUG] Response data:', response.data);
  } catch (error) {
    console.error('[ERROR] Could not submit chat input:', error.message);
  }

  console.log('[DEBUG] Test completed.');
})();
