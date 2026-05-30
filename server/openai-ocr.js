const fetch = require("./fetch");
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
  if (!trimmed) {
    return {};
  }
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
  if (forbidden.includes(cleaned) || forbidden.some(label => cleaned.startsWith(`${label}:`) || cleaned.startsWith(`${label}：`))) {
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
  const timeoutMs = Number(process.env.OPENAI_OCR_TIMEOUT_MS || 12000);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
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
      "3. 如果没有“用户名”，再按顺序取“账号/昵称/用户名称”后面的真实值。",
      "4. 如果以上字段都没有，再识别“停车智管ID/用户ID/游戏ID/ID”后面的值。",
      "5. 如果 ID 在图片中被遮挡、截断或尾部有省略号，只返回能看清的部分，并截到最后一个英文字母或数字为止。",
      "6. 不要把“用户名/账号/昵称/用户ID/ID”等字段名本身作为 gameId。",
      "7. 如果没有明确用户名或 ID，gameId 返回空字符串。",
      "8. 只返回 JSON，不要解释。",
      "JSON 格式：{\"rawText\":\"图片中能读到的文字\",\"gameId\":\"\"}"
    ].join("\n");

  let response;
  try {
    response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageUrl, detail: process.env.OPENAI_OCR_IMAGE_DETAIL || "low" }
            ]
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        },
        max_output_tokens: 300
      })
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`OpenAI OCR超时：${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI OCR失败：${response.status} ${errorText}`);
  }
  const data = await response.json();
  const text = outputTextFromResponse(data);
  const parsed = safeParseJson(text);
  if (!text.trim() && !parsed.rawText) {
    throw new Error("OpenAI OCR未返回可解析文本");
  }
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
