const assert = require("assert");
const qiniuService = require("../server/qiniu-service");

qiniuService.loadEnvFile();

async function main() {
  assert.ok(qiniuService.isEnabled(), "Qiniu config is not enabled");

  const base64Png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const buffer = Buffer.from(base64Png, "base64");
  const key = `task-submit/test/pixel-${Date.now()}.png`;
  const result = await qiniuService.uploadBuffer(buffer, { key });

  assert.ok(result.key, "missing uploaded key");
  assert.ok(result.url, "missing uploaded url");

  console.log(JSON.stringify({
    key: result.key,
    url: result.url,
    hash: result.hash || ""
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
