const fs = require("fs");
const path = require("path");

let qiniu = null;
try {
  qiniu = require("qiniu");
} catch (error) {
  qiniu = null;
}

const REGION_MAP = {
  z0: "Zone_z0",
  z1: "Zone_z1",
  z2: "Zone_z2",
  na0: "Zone_na0",
  as0: "Zone_as0"
};

function getConfig() {
  const {
    QINIU_ACCESS_KEY,
    QINIU_SECRET_KEY,
    QINIU_BUCKET,
    QINIU_DOMAIN,
    QINIU_REGION = "z0",
    QINIU_AI_API_KEY
  } = process.env;
  return {
    accessKey: QINIU_ACCESS_KEY,
    secretKey: QINIU_SECRET_KEY,
    bucket: QINIU_BUCKET,
    domain: QINIU_DOMAIN,
    region: QINIU_REGION,
    aiApiKey: QINIU_AI_API_KEY
  };
}

function isEnabled() {
  const config = getConfig();
  return Boolean(qiniu && config.accessKey && config.secretKey && config.bucket && config.domain);
}

function publicUrl(key) {
  const { domain } = getConfig();
  const normalizedDomain = /^https?:\/\//i.test(String(domain || ""))
    ? String(domain || "")
    : `https://${domain}`;
  const encodedKey = String(key || "")
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
  return `${normalizedDomain.replace(/\/$/, "")}/${encodedKey}`;
}

function uploadBuffer(buffer, options = {}) {
  if (!isEnabled()) {
    return Promise.resolve(null);
  }
  const config = getConfig();
  const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${config.bucket}:${options.key}`
  });
  const uploadToken = putPolicy.uploadToken(mac);
  const qiniuConfig = new qiniu.conf.Config();
  const zoneName = REGION_MAP[config.region] || REGION_MAP.z0;
  qiniuConfig.zone = qiniu.zone[zoneName];
  const formUploader = new qiniu.form_up.FormUploader(qiniuConfig);
  const putExtra = new qiniu.form_up.PutExtra();

  return new Promise((resolve, reject) => {
    formUploader.put(uploadToken, options.key, buffer, putExtra, (error, body, info) => {
      if (error) {
        reject(error);
        return;
      }
      if (info.statusCode >= 200 && info.statusCode < 300) {
        resolve({
          key: body.key || options.key,
          hash: body.hash,
          url: publicUrl(body.key || options.key)
        });
        return;
      }
      reject(new Error(`七牛上传失败：${info.statusCode} ${JSON.stringify(body || {})}`));
    });
  });
}

function extractFields(text, kind) {
  const compact = String(text || "").replace(/\s+/g, " ");
  if (kind === "order") {
    const match = compact.match(/(?:订单号|订单编号|订单|单号)[:：\s]*([A-Za-z0-9-]{6,})/) || compact.match(/\b[A-Za-z0-9-]{10,}\b/);
    return {
      orderNo: match ? match[1] || match[0] : ""
    };
  }
  const match = compact.match(/(?:ID|Id|id|游戏ID|账号)[:：\s]*([A-Za-z0-9_-]{3,})/) || compact.match(/\b[A-Za-z0-9_-]{5,}\b/);
  return {
    gameId: match ? match[1] || match[0] : ""
  };
}

async function recognizeImage(imageUrl, kind) {
  const { aiApiKey } = getConfig();
  if (!aiApiKey || !imageUrl || typeof fetch !== "function") {
    return {};
  }

  const response = await fetch("https://api.qnaigc.com/v1/images/ocr", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${aiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "ocr",
      url: imageUrl
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`七牛OCR失败：${response.status} ${errorText}`);
  }
  const data = await response.json();
  const text = data.text || JSON.stringify(data);
  return {
    raw: data,
    text,
    ...extractFields(text, kind)
  };
}

function loadEnvFile(file = path.resolve(__dirname, "..", ".env")) {
  if (!fs.existsSync(file)) {
    return;
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

module.exports = {
  extractFields,
  getConfig,
  isEnabled,
  loadEnvFile,
  publicUrl,
  recognizeImage,
  uploadBuffer
};
