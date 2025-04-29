// test_openai_key.js
require("dotenv").config();
const { OpenAI } = require("openai");

// Ensure your .env has: OPENAI_API_KEY=sk-xxxxxxx
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  try {
    const modelsResponse = await openai.models.list();
    const modelIds = modelsResponse.data.map((model) => model.id);

    // Sort models alphabetically
    const sortedModelIds = modelIds.sort((a, b) => a.localeCompare(b));

    console.log("Models accessible with your API key:");
    console.log(sortedModelIds);

    // Check if GPT-4 is listed
    if (modelIds.includes("gpt-4")) {
      console.log("Great! Your key can access GPT-4.");
    } else {
      console.warn(
          "GPT-4 not found in your available models. " +
          "You may not have access to it on this key."
      );
    }
  } catch (error) {
    console.error("Error calling OpenAI API =>", error);
  }
})();
