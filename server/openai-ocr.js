const { extractFields } = require("./qiniu-service");

function getConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_OCR_MODEL || "gpt-4.1-mini"
  };
}

function isEnabled() {
  return Boolean(getConfig().apiKey);
}

function safeParseJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw error;
  }
}

function cleanExtractedValue(value, kind) {
  const cleaned = String(value || "")
    .replace(/^[：:\s]+/, "")
    .replace(/[，,。；;\s]+$/g, "")
    .trim();
  const forbidden = kind === "order"
    ? ["订单号", "订单编号", "订单", "单号"]
    : ["ID", "Id", "id", "游戏ID", "账号", "用户名", "用户名称", "昵称", "用户ID"];
  if (forbidden.includes(cleaned)) {
    return "";
  }
  return cleaned;
}

function outputTextFromResponse(data) {
  if (data.output_text) {
    return data.output_text;
  }
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n");
}

async function recognizeImage(imageUrl, kind) {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) {
    return {};
  }
  const prompt = kind === "order"
    ? [
      "你是表单图片 OCR 字段提取器。",
      "任务：从图片中识别订单号。",
      "要求：",
      "1. 先阅读图片中文字，不要猜测。",
      "2. orderNo 必须是字段“订单号/订单编号/单号”后面的真实编号值。",
      "3. 不要把“订单号”这三个字本身作为 orderNo。",
      "4. 如果没有明确编号，orderNo 返回空字符串。",
      "5. 只返回 JSON，不要解释。",
      "JSON 格式：{\"rawText\":\"图片中能读到的文字\",\"orderNo\":\"\"}"
    ].join("\n")
    : [
      "你是表单图片 OCR 字段提取器。",
      "任务：从图片中识别用户名。",
      "要求：",
      "1. 先阅读图片中文字，不要猜测。",
      "2. gameId 必须优先取字段“用户名”后面的真实值。",
      "3. 如果没有“用户名”，再取“账号/昵称/用户名称”后面的真实值。",
      "4. 不要提取“用户ID”字段，因为用户ID经常被截断。",
      "5. 不要把“用户名/账号/昵称/用户ID”等字段名本身作为 gameId。",
      "6. 如果没有明确用户名，gameId 返回空字符串。",
      "7. 只返回 JSON，不要解释。",
      "JSON 格式：{\"rawText\":\"图片中能读到的文字\",\"gameId\":\"\"}"
    ].join("\n");

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl, detail: "high" }
          ]
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI OCR失败：${response.status} ${errorText}`);
  }
  const data = await response.json();
  const text = outputTextFromResponse(data);
  const parsed = safeParseJson(text);
  const extracted = {
    ...extractFields(parsed.rawText || text, kind),
    ...parsed
  };
  if ("orderNo" in extracted) {
    extracted.orderNo = cleanExtractedValue(extracted.orderNo, "order");
  }
  if ("gameId" in extracted) {
    extracted.gameId = cleanExtractedValue(extracted.gameId, "gameId");
  }
  return {
    raw: data,
    text,
    ...extracted
  };
}

module.exports = {
  getConfig,
  isEnabled,
  recognizeImage
};
