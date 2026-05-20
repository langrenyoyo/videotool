const fs = require("fs");
const http = require("http");
const path = require("path");
const qiniuService = require("./qiniu-service");

qiniuService.loadEnvFile();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

const defaultDb = {
  settings: {
    projectName: "萱桦舒缓伴侣后续",
    taskCode: "qf4M84e",
    sectionTitle: "重点内容",
    updatedAt: "2026-04-29 09:43",
    amountText: "6元",
    content:
      "后续任务要求：从小窗显示萱桦 APP 开始录屏，下载充值软件并打开进行充值，充值金额为 6 元或充足 6 元。充值完成后结束录屏，上传萱桦 ID、充值视频。",
    stepsText:
      "打开萱桦 APP，并从小窗显示开始录屏\n按任务要求完成充值操作\n充值完成后停止录屏\n在提交页填写萱桦 ID 并上传充值视频",
    warningsText:
      "请勿上传含支付密码、验证码、身份证号等敏感信息的视频\n仅提交任务要求所需信息，确认无误后再提交",
    requiredMaterialsText:
      "萱桦 ID\n充值完成后的录屏视频"
  },
  submissions: []
};

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb(defaultDb);
  }
}

function readDb() {
  ensureStore();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db.settings = normalizeSettings(db.settings || {});
  db.submissions = db.submissions || [];
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) {
    throw new Error("缺少 multipart boundary");
  }
  const boundary = `--${match[1] || match[2]}`;
  const raw = buffer.toString("binary");
  const parts = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = {};

  for (const part of parts) {
    const clean = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitIndex = clean.indexOf("\r\n\r\n");
    if (splitIndex < 0) {
      continue;
    }
    const header = clean.slice(0, splitIndex);
    let body = clean.slice(splitIndex + 4);
    if (body.endsWith("\r\n")) {
      body = body.slice(0, -2);
    }
    const nameMatch = /name="([^"]+)"/.exec(header);
    if (!nameMatch) {
      continue;
    }
    const name = nameMatch[1];
    const fileMatch = /filename="([^"]*)"/.exec(header);
    if (fileMatch) {
      const contentTypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(header);
      files[name] = {
        filename: path.basename(fileMatch[1] || "video.mp4"),
        contentType: contentTypeMatch ? contentTypeMatch[1] : "application/octet-stream",
        buffer: Buffer.from(body, "binary")
      };
    } else {
      fields[name] = Buffer.from(body, "binary").toString("utf8");
    }
  }
  return { fields, files };
}

function extByKind(kind, filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext) {
    return ext;
  }
  if (kind === "video") {
    return ".mp4";
  }
  return ".jpg";
}

function statusText(status) {
  return {
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回"
  }[status] || "待审核";
}

function normalizeSettings(settings) {
  return {
    ...defaultDb.settings,
    ...settings
  };
}

function settingsToTask(settings) {
  const safe = normalizeSettings(settings);
  const splitLines = value => String(value || "")
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
  return {
    code: safe.taskCode,
    title: safe.projectName,
    sectionTitle: safe.sectionTitle,
    updatedAt: safe.updatedAt,
    amountText: safe.amountText,
    content: safe.content,
    steps: splitLines(safe.stepsText),
    warnings: splitLines(safe.warningsText),
    requiredMaterials: splitLines(safe.requiredMaterialsText)
  };
}

function htmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>任务审核后台</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f6f8; color: #1f2329; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { background: #fff; border-bottom: 1px solid #e7e9ee; padding: 18px 28px; }
    h1 { margin: 0; font-size: 22px; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; }
    section, article { background: #fff; border: 1px solid #e7e9ee; border-radius: 8px; padding: 20px; }
    .settings { display: grid; gap: 14px; }
    .settings-grid { display: grid; grid-template-columns: 1fr 180px 180px; gap: 12px; }
    label { display: block; color: #4b5563; font-size: 13px; margin-bottom: 8px; }
    input, textarea { width: 100%; border: 1px solid #d7dce5; border-radius: 6px; font: inherit; padding: 10px 12px; }
    button { border: 0; border-radius: 6px; cursor: pointer; font: inherit; font-weight: 600; padding: 10px 16px; }
    .primary { background: #1677ff; color: #fff; }
    .secondary { background: #eef2f7; color: #1f2329; }
    .danger { background: #fff1f0; color: #c23a2b; }
    .ok { background: #eaf8ef; color: #16763b; }
    .toolbar { align-items: center; display: flex; justify-content: space-between; margin: 24px 0 14px; }
    .list { display: grid; gap: 16px; }
    .record-head { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; }
    .title { font-size: 17px; font-weight: 700; }
    .muted { color: #6b7280; font-size: 13px; }
    .status { border-radius: 999px; font-size: 13px; padding: 5px 10px; }
    .pending { background: #fff7e6; color: #ad6800; }
    .approved { background: #eaf8ef; color: #16763b; }
    .rejected { background: #fff1f0; color: #c23a2b; }
    .grid { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr) 360px; margin-top: 16px; }
    video, img { background: #000; border-radius: 6px; display: block; width: 100%; }
    video { height: 240px; object-fit: cover; }
    img { margin-bottom: 10px; object-fit: cover; }
    .asset-grid { display: grid; gap: 12px; }
    .asset-title { color: #526071; font-size: 13px; font-weight: 600; margin: 10px 0 8px; }
    .actions { display: flex; gap: 10px; margin-top: 12px; }
    .empty { color: #6b7280; padding: 32px; text-align: center; }
    @media (max-width: 780px) { .settings-grid, .grid { grid-template-columns: 1fr; } main { padding: 16px; } }
  </style>
</head>
<body>
  <header><h1>任务审核后台</h1></header>
  <main>
    <section class="settings">
      <h2 style="margin:0;font-size:18px;">小程序前端信息</h2>
      <div class="settings-grid">
        <div>
          <label for="projectName">项目名称</label>
          <input id="projectName" placeholder="请输入项目名称">
        </div>
        <div>
          <label for="amountText">金额标签</label>
          <input id="amountText" placeholder="如 6元">
        </div>
        <div>
          <label for="sectionTitle">内容标题</label>
          <input id="sectionTitle" placeholder="如 重点内容">
        </div>
      </div>
      <div>
        <label for="content">任务正文</label>
        <textarea id="content" rows="4" placeholder="请输入小程序详情页展示的任务说明"></textarea>
      </div>
      <div>
        <label for="stepsText">操作步骤，每行一条</label>
        <textarea id="stepsText" rows="5" placeholder="每行一条步骤"></textarea>
      </div>
      <div>
        <label for="warningsText">提交前提醒，每行一条</label>
        <textarea id="warningsText" rows="4" placeholder="每行一条提醒"></textarea>
      </div>
      <div>
        <label for="requiredMaterialsText">提交资料清单，每行一条</label>
        <textarea id="requiredMaterialsText" rows="3" placeholder="每行一条资料要求"></textarea>
      </div>
      <div>
        <button class="primary" onclick="saveSettings()">保存前端信息</button>
      </div>
    </section>
    <div class="toolbar">
      <h2 style="margin:0;font-size:18px;">提交资料</h2>
      <button class="secondary" onclick="loadData()">刷新</button>
    </div>
    <div id="list" class="list"></div>
  </main>
  <script>
    const statusText = ${statusText.toString()};
    async function request(url, options) {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '请求失败');
      return data;
    }
    async function loadData() {
      const settings = await request('/api/settings');
      document.querySelector('#projectName').value = settings.projectName || '';
      document.querySelector('#amountText').value = settings.amountText || '';
      document.querySelector('#sectionTitle').value = settings.sectionTitle || '';
      document.querySelector('#content').value = settings.content || '';
      document.querySelector('#stepsText').value = settings.stepsText || '';
      document.querySelector('#warningsText').value = settings.warningsText || '';
      document.querySelector('#requiredMaterialsText').value = settings.requiredMaterialsText || '';
      const submissions = await request('/api/submissions');
      const list = document.querySelector('#list');
      if (!submissions.length) {
        list.innerHTML = '<section class="empty">暂无提交资料</section>';
        return;
      }
      list.innerHTML = submissions.map(item => \`
        <article>
          <div class="record-head">
            <div>
              <div class="title">\${escapeHtml(item.taskTitle || '')}</div>
              <div class="muted">游戏ID：\${escapeHtml(item.gameId || '')} · 订单号：\${escapeHtml(item.orderNo || '')} · 提交时间：\${new Date(item.createdAt).toLocaleString()}</div>
            </div>
            <div class="status \${item.status || 'pending'}">\${statusText(item.status)}</div>
          </div>
          <div class="grid">
            <div>
              <div class="asset-title">资料预览</div>
              <div class="asset-grid">
                \${item.gameIdImageUrl ? '<img src="' + item.gameIdImageUrl + '" alt="游戏ID截图">' : ''}
                \${item.orderImageUrl ? '<img src="' + item.orderImageUrl + '" alt="订单截图">' : ''}
                \${item.videoUrl ? '<video src="' + item.videoUrl + '" controls></video>' : ''}
              </div>
              <label>审核备注</label>
              <textarea id="remark-\${item.id}" rows="5" placeholder="可填写通过或驳回原因">\${escapeHtml(item.reviewRemark || '')}</textarea>
              <div class="actions">
                <button class="ok" onclick="review('\${item.id}', 'approved')">通过</button>
                <button class="danger" onclick="review('\${item.id}', 'rejected')">驳回</button>
              </div>
            </div>
            <video src="\${item.videoUrl}" controls></video>
          </div>
        </article>
      \`).join('');
    }
    async function saveSettings() {
      await request('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: document.querySelector('#projectName').value,
          amountText: document.querySelector('#amountText').value,
          sectionTitle: document.querySelector('#sectionTitle').value,
          content: document.querySelector('#content').value,
          stepsText: document.querySelector('#stepsText').value,
          warningsText: document.querySelector('#warningsText').value,
          requiredMaterialsText: document.querySelector('#requiredMaterialsText').value
        })
      });
      alert('已保存');
      loadData();
    }
    async function review(id, status) {
      const reviewRemark = document.querySelector('#remark-' + id).value;
      await request('/api/submissions/' + encodeURIComponent(id) + '/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewRemark })
      });
      loadData();
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
    }
    loadData().catch(error => alert(error.message));
  </script>
</body>
</html>`;
}

function withVideoUrl(req, item) {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  return {
    ...item,
    videoUrl: item.videoFile ? `http://${host}/uploads/${encodeURIComponent(item.videoFile)}` : ""
  };
}

function withAssetUrls(req, item) {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const assetUrl = file => {
    if (!file) {
      return "";
    }
    if (/^https?:\/\//i.test(file)) {
      return file;
    }
    return `http://${host}/uploads/${encodeURIComponent(file)}`;
  };
  return {
    ...item,
    gameIdImageUrl: assetUrl(item.gameIdImageFile),
    orderImageUrl: assetUrl(item.orderImageFile),
    videoUrl: assetUrl(item.videoFile)
  };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 200, {});
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin") {
    sendHtml(res, htmlPage());
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const file = path.basename(decodeURIComponent(url.pathname.replace("/uploads/", "")));
    const target = path.join(UPLOAD_DIR, file);
    if (!fs.existsSync(target)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4" });
    fs.createReadStream(target).pipe(res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, readDb().settings);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/task") {
    sendJson(res, 200, settingsToTask(readDb().settings));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/files") {
    const kind = url.searchParams.get("kind") || "asset";
    const body = await readBody(req);
    const { files } = parseMultipart(body, req.headers["content-type"]);
    const file = files.file;
    if (!file) {
      sendJson(res, 400, { message: "缺少文件" });
      return;
    }
    const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = extByKind(kind, file.filename);
    const fileName = `${id}${ext}`;
    let stored = null;
    let recognize = {};
    try {
      stored = await qiniuService.uploadBuffer(file.buffer, {
        key: `task-submit/${kind}/${fileName}`
      });
    } catch (error) {
      console.error("七牛上传失败，回退到本地存储：", error.message);
    }
    if (!stored) {
      fs.writeFileSync(path.join(UPLOAD_DIR, fileName), file.buffer);
      stored = {
        key: fileName,
        url: `http://${req.headers.host || `127.0.0.1:${PORT}`}/uploads/${encodeURIComponent(fileName)}`
      };
    }
    if (kind === "gameId" || kind === "order") {
      try {
        recognize = await qiniuService.recognizeImage(stored.url, kind);
      } catch (error) {
        console.error("OCR识别失败：", error.message);
      }
    }
    sendJson(res, 201, {
      fileId: stored.url,
      key: stored.key,
      url: stored.url,
      recognize
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const db = readDb();
    db.settings = normalizeSettings({
      ...db.settings,
      projectName: String(body.projectName || "").trim() || defaultDb.settings.projectName,
      amountText: String(body.amountText || "").trim() || defaultDb.settings.amountText,
      sectionTitle: String(body.sectionTitle || "").trim() || defaultDb.settings.sectionTitle,
      content: String(body.content || "").trim() || defaultDb.settings.content,
      stepsText: String(body.stepsText || "").trim() || defaultDb.settings.stepsText,
      warningsText: String(body.warningsText || "").trim() || defaultDb.settings.warningsText,
      requiredMaterialsText: String(body.requiredMaterialsText || "").trim() || defaultDb.settings.requiredMaterialsText,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false })
    });
    writeDb(db);
    sendJson(res, 200, db.settings);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/submissions") {
    const xuanhuaId = url.searchParams.get("xuanhuaId");
    const db = readDb();
    const list = xuanhuaId
      ? db.submissions.filter(item => item.gameId === xuanhuaId || item.xuanhuaId === xuanhuaId)
      : db.submissions;
    sendJson(res, 200, list.map(item => withAssetUrls(req, item)));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/submissions") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    if (!body.gameId || !body.orderNo || !body.gameIdImageFileId || !body.orderImageFileId || !body.videoFileId) {
      sendJson(res, 400, { message: "资料不完整" });
      return;
    }
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const db = readDb();
    const submission = {
      id,
      taskCode: body.taskCode || "",
      taskTitle: body.taskTitle || db.settings.projectName,
      xuanhuaId: String(body.gameId || "").trim(),
      gameId: String(body.gameId || "").trim(),
      orderNo: String(body.orderNo || "").trim(),
      gameIdImageFile: body.gameIdImageFileId,
      orderImageFile: body.orderImageFileId,
      videoFile: body.videoFileId,
      status: "pending",
      reviewRemark: "",
      createdAt: Date.now()
    };
    db.submissions.unshift(submission);
    writeDb(db);
    sendJson(res, 201, withAssetUrls(req, submission));
    return;
  }
  const reviewMatch = /^\/api\/submissions\/([^/]+)\/review$/.exec(url.pathname);
  if (req.method === "POST" && reviewMatch) {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const db = readDb();
    const target = db.submissions.find(item => item.id === reviewMatch[1]);
    if (!target) {
      sendJson(res, 404, { message: "提交记录不存在" });
      return;
    }
    target.status = body.status === "rejected" ? "rejected" : "approved";
    target.reviewRemark = String(body.reviewRemark || "").trim();
    target.reviewedAt = Date.now();
    writeDb(db);
    sendJson(res, 200, withAssetUrls(req, target));
    return;
  }
  sendJson(res, 404, { message: "Not found" });
}

if (require.main === module) {
  ensureStore();
  http.createServer((req, res) => {
    handle(req, res).catch(error => {
      console.error(error);
      sendJson(res, 500, { message: error.message || "服务器错误" });
    });
  }).listen(PORT, () => {
    console.log(`Admin server: http://127.0.0.1:${PORT}/admin`);
  });
}

module.exports = {
  handle,
  readDb,
  writeDb,
  settingsToTask,
  defaultDb
};
