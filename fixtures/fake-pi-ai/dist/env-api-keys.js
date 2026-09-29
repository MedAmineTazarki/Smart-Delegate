// Test fixture mirroring pi-ai's findEnvKeys(provider, env): names of set key variables.
const KEYS = { anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"], zai: ["ZAI_API_KEY"] };
export function findEnvKeys(provider, env = process.env) {
  const found = (KEYS[provider] ?? []).filter((k) => env[k]);
  return found.length ? found : undefined;
}
