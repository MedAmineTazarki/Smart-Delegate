// Minimal stand-in for pi-ai's generated catalog (test fixture).
export const MODELS = {
  anthropic: {
    "claude-big-9": { id: "claude-big-9", input: ["text", "image"], cost: { input: 10, output: 50 }, contextWindow: 1000000, maxTokens: 128000, reasoning: true },
    "claude-small-1": { id: "claude-small-1", input: ["text", "image"], cost: { input: 1, output: 5 }, contextWindow: 200000, maxTokens: 64000, reasoning: false },
  },
  zai: {
    "glm-x": { id: "glm-x", input: ["text"], cost: { input: 0.6, output: 2.2 }, contextWindow: 204800, maxTokens: 131072, reasoning: true },
  },
  "openai-codex": {
    "gpt-sub": { id: "gpt-sub", input: ["text", "image"], cost: { input: 0, output: 0 }, contextWindow: 400000, maxTokens: 128000, reasoning: true },
  },
};
