const fs = require("fs");
const path = require("path");

require("../server/qiniu-service").loadEnvFile();
const qiniuService = require("../server/qiniu-service");
const openaiOcr = require("../server/openai-ocr");

const cases = [
  { file: "C:/Users/Administrator/Desktop/111.jpg", kind: "order" },
  { file: "C:/Users/Administrator/Desktop/222.jpg", kind: "gameId" }
];

async function main() {
  const config = openaiOcr.getConfig();
  console.log(JSON.stringify({
    openai: {
      enabled: openaiOcr.isEnabled(),
      baseUrl: config.baseUrl,
      model: config.model,
      hasKey: Boolean(config.apiKey)
    }
  }, null, 2));

  for (const item of cases) {
    const key = `task-submit/test/ai-${item.kind}-${Date.now()}${path.extname(item.file)}`;
    const uploaded = await qiniuService.uploadBuffer(fs.readFileSync(item.file), { key });
    const recognized = await openaiOcr.recognizeImage(uploaded.url, item.kind);
    console.log(JSON.stringify({
      file: path.basename(item.file),
      kind: item.kind,
      url: uploaded.url,
      result: {
        gameId: recognized.gameId || "",
        orderNo: recognized.orderNo || "",
        rawText: recognized.rawText || "",
        text: recognized.text || ""
      }
    }, null, 2));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
