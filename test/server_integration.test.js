const axios = require("axios");

describe("Integration tests for server_webserver.js", () => {
    const baseUrl = "http://localhost:3000";

    it("GET / should redirect to /repositories", async () => {
        const response = await axios.get(`${baseUrl}/`, { maxRedirects: 0 }).catch(err => err.response);
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("/repositories");
    });

    it("GET /repositories should return 200 and render repositories", async () => {
        const response = await axios.get(`${baseUrl}/repositories`);
        expect(response.status).toBe(200);
        // Additional assertions can be added here
    });

    it("GET /alfe-dev should redirect to /alfe-dev/chats", async () => {
        const response = await axios.get(`${baseUrl}/alfe-dev`, { maxRedirects: 0 }).catch(err => err.response);
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("/alfe-dev/chats");
    });

    it("GET /alfe-dev/chats should return 200 and list chats", async () => {
        const response = await axios.get(`${baseUrl}/alfe-dev/chats`);
        expect(response.status).toBe(200);
        // Additional assertions can be added here
    });

    it("GET /alfe-dev/chat/1 should return 200 and render chat page", async () => {
        const response = await axios.get(`${baseUrl}/alfe-dev/chat/1`);
        expect(response.status).toBe(200);
        // Additional assertions can be added here
    });

    it("POST /set_chat_model should set the AI model and redirect", async () => {
        const payload = {
            gitRepoNameCLI: "alfe-dev",
            chatNumberCLI: "1",
            aiModel: "gpt-4"
        };
        const response = await axios.post(`${baseUrl}/set_chat_model`, payload, { maxRedirects: 0 }).catch(err => err.response);
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("/alfe-dev/chat/1");
    });

    it("POST /alfe-dev/chat/1 should process a user message", async () => {
        const payload = {
            message: "Hello from test",
            attachedFiles: JSON.stringify([])
        };
        const response = await axios.post(`${baseUrl}/alfe-dev/chat/1`, payload);
        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.assistantReply).toBeDefined();
    });

    it("POST /alfe-dev/chat/999 should return 404 for non-existent chat", async () => {
        const payload = {
            message: "Test message"
        };
        const response = await axios.post(`${baseUrl}/alfe-dev/chat/999`, payload).catch(err => err.response);
        expect(response.status).toBe(404);
    });

    it("POST /alfe-dev/chat/1/save_agent_instructions should save instructions", async () => {
        const payload = {
            agentInstructions: "Test agent instructions"
        };
        const response = await axios.post(`${baseUrl}/alfe-dev/chat/1/save_agent_instructions`, payload, { maxRedirects: 0 }).catch(err => err.response);
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("/alfe-dev/chat/1");
    });

    it("POST /alfe-dev/git_update should update repository", async () => {
        const response = await axios.post(`${baseUrl}/alfe-dev/git_update`);
        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.currentCommit).toBeDefined();
    });

    it("POST /analyze_project should analyze the project", async () => {
        const payload = {
            repoName: "alfe-dev",
            format: "plainText"
        };
        const response = await axios.post(`${baseUrl}/analyze_project`, payload);
        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
    });
});
