const express = require('express');
const router = express.Router();

/**
 * POST /createChat
 * Creates a new chat.
 */
router.post('/createChat', (req, res) => {
  // Minimal example body
  // In a real application, you'd parse request data
  // and integrate logic for creating a chat record.
  console.log("[DEBUG] POST /createChat => creating new chat");

  // For demonstration:
  const chatData = {
    chatId: Math.floor(Math.random() * 100000),
    status: "ACTIVE",
    message: req.body.message || "No message provided",
    createdAt: new Date().toISOString()
  };

  console.log("[DEBUG] New chatData =>", chatData);

  // Return a success response
  return res.json({
    success: true,
    data: chatData
  });
});

module.exports = router;
