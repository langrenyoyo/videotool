const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { loadEnvFile } = require("../server/qiniu-service");

const tempEnvFile = path.join(root, "server", "data", `load-env-test-${process.pid}.env`);
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalOpenAiBaseUrl = process.env.OPENAI_BASE_URL;

try {
  fs.writeFileSync(tempEnvFile, "OPENAI_API_KEY=from_env_file\nOPENAI_BASE_URL=https://api.openai.com/v1\n", "utf8");
  process.env.OPENAI_API_KEY = "from_process_env";
  process.env.OPENAI_BASE_URL = "https://old.example.com/v1";

  loadEnvFile(tempEnvFile);

  assert.strictEqual(process.env.OPENAI_API_KEY, "from_env_file");
  assert.strictEqual(process.env.OPENAI_BASE_URL, "https://api.openai.com/v1");
  console.log("Env load test passed");
} finally {
  if (fs.existsSync(tempEnvFile)) {
    fs.unlinkSync(tempEnvFile);
  }
  if (typeof originalOpenAiApiKey === "undefined") {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  }
  if (typeof originalOpenAiBaseUrl === "undefined") {
    delete process.env.OPENAI_BASE_URL;
  } else {
    process.env.OPENAI_BASE_URL = originalOpenAiBaseUrl;
  }
}
