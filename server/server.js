const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fetch = require("./fetch");
const openaiOcr = require("./openai-ocr");
const qiniuService = require("./qiniu-service");

qiniuService.loadEnvFile();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bb654321";
const ADMIN_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const adminSessions = new Map();

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
      "萱桦 ID\n充值完成后的录屏视频",
    formDesc: "上传萱桦ID截图，订单截图，充值视频",
    gameIdImageTitle: "萱桦游戏id截图",
    gameIdImageTip: "请正面拍摄，要求内容清晰完整，方便AI识别",
    gameIdFieldLabel: "ID",
    orderImageTitle: "订单截图",
    orderImageTip: "请正面拍摄，要求内容清晰完整，方便AI识别",
    orderFieldLabel: "订单号",
    videoTitle: "充值视频",
    submitButtonText: "提交",
    submitTip: "提交即授权该表单收集你填写的信息，查看详情"
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

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function parseCookies(header = "") {
  return header.split(";").reduce((acc, item) => {
    const index = item.indexOf("=");
    if (index < 0) return acc;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value || "");
    return acc;
  }, {});
}

function getAdminToken(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.admin_sid || "";
  if (!token) return "";
  const session = adminSessions.get(token);
  if (!session) return "";
  if (session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return "";
  }
  return token;
}

function isAdminAuthed(req) {
  return Boolean(getAdminToken(req));
}

function makeAdminSession() {
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, { expiresAt: Date.now() + ADMIN_SESSION_TTL });
  return token;
}

function clearAdminSession(req) {
  const token = getAdminToken(req);
  if (token) adminSessions.delete(token);
}

function setAdminCookie(res, token) {
  res.setHeader("Set-Cookie", `admin_sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_TTL / 1000)}`);
}

function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", "admin_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
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
  const merged = {
    ...defaultDb.settings,
    ...settings
  };
  const rawProjects = Array.isArray(merged.projects) ? merged.projects : [];
  const projects = rawProjects
    .map(item => ({
      id: String(item.id || "").trim(),
      name: String(item.name || "").trim()
    }))
    .filter(item => item.name);
  if (!projects.length) {
    projects.push({
      id: `project_${Date.now()}`,
      name: String(merged.projectName || defaultDb.settings.projectName).trim()
    });
  }
  if (!merged.projectName && projects[0]) {
    merged.projectName = projects[0].name;
  }
  return {
    ...merged,
    projects
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
    projects: safe.projects,
    sectionTitle: safe.sectionTitle,
    updatedAt: safe.updatedAt,
    amountText: safe.amountText,
    content: safe.content,
    steps: splitLines(safe.stepsText),
    warnings: splitLines(safe.warningsText),
    requiredMaterials: splitLines(safe.requiredMaterialsText),
    form: {
      desc: safe.formDesc,
      gameIdImageTitle: safe.gameIdImageTitle,
      gameIdImageTip: safe.gameIdImageTip,
      gameIdFieldLabel: safe.gameIdFieldLabel,
      orderImageTitle: safe.orderImageTitle,
      orderImageTip: safe.orderImageTip,
      orderFieldLabel: safe.orderFieldLabel,
      videoTitle: safe.videoTitle,
      submitButtonText: safe.submitButtonText,
      submitTip: safe.submitTip
    }
  };
}

function htmlShell(title, body, script = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f6f8; color: #1f2329; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { background: #fff; border-bottom: 1px solid #e7e9ee; padding: 18px 28px; }
    h1 { margin: 0; font-size: 22px; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; }
    nav { display: flex; gap: 10px; margin-top: 12px; }
    nav a { background: #eef2f7; border-radius: 6px; color: #1f2329; padding: 8px 12px; text-decoration: none; }
    section, article { background: #fff; border: 1px solid #e7e9ee; border-radius: 8px; padding: 20px; }
    .settings { display: grid; gap: 14px; }
    .settings-grid { display: grid; grid-template-columns: 1fr 180px 180px; gap: 12px; }
    .project-row { align-items: center; display: grid; gap: 12px; grid-template-columns: 1fr auto auto; }
    .project-row + .project-row { margin-top: 10px; }
    .project-list { display: grid; gap: 10px; }
    label { display: block; color: #4b5563; font-size: 13px; margin-bottom: 8px; }
    input, select, textarea { width: 100%; border: 1px solid #d7dce5; border-radius: 6px; font: inherit; padding: 10px 12px; }
    button { border: 0; border-radius: 6px; cursor: pointer; font: inherit; font-weight: 600; padding: 10px 16px; }
    .primary { background: #1677ff; color: #fff; }
    .secondary { background: #eef2f7; color: #1f2329; }
    .danger { background: #fff1f0; color: #c23a2b; }
    .ok { background: #eaf8ef; color: #16763b; }
    .toolbar { align-items: center; display: flex; justify-content: space-between; margin: 24px 0 14px; }
    .filter-panel { margin: 0 0 16px; }
    .filter-grid { align-items: end; display: grid; gap: 12px; grid-template-columns: 1fr 1fr 1fr auto auto; }
    .filter-actions { display: flex; gap: 10px; }
    .stats-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 0 16px; }
    .stat-card { background: #fff; border: 1px solid #e7e9ee; border-radius: 8px; padding: 16px 18px; }
    .stat-label { color: #6b7280; font-size: 13px; }
    .stat-value { font-size: 28px; font-weight: 800; line-height: 1.2; margin-top: 6px; }
    .stat-pending .stat-value { color: #ad6800; }
    .stat-rejected .stat-value { color: #c23a2b; }
    .stat-approved .stat-value { color: #16763b; }
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
    video { height: auto; max-height: 70vh; object-fit: contain; }
    img { margin-bottom: 10px; object-fit: cover; }
    .asset-grid { display: grid; gap: 12px; }
    .asset-title { color: #526071; font-size: 13px; font-weight: 600; margin: 10px 0 8px; }
    .actions { display: flex; gap: 10px; margin-top: 12px; }
    .empty { color: #6b7280; padding: 32px; text-align: center; }
    .nav-card { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nav-card a { color: inherit; text-decoration: none; }
    .field-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .field-line { background: #f8fafc; border: 1px solid #e7e9ee; border-radius: 6px; padding: 10px 12px; }
    .field-name { color: #6b7280; font-size: 12px; margin-bottom: 4px; }
    .field-value { font-weight: 700; word-break: break-all; }
    @media (max-width: 780px) { .settings-grid, .grid, .filter-grid, .stats-grid { grid-template-columns: 1fr; } main { padding: 16px; } .filter-actions { display: grid; grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <nav>
      <a href="/admin/settings">前端页面设置</a>
      <a href="/admin/review">审核页面</a>
      <a href="/admin/logout">退出登录</a>
    </nav>
  </header>
  <main>
    ${body}
  </main>
  <script>
    ${script}
  </script>
</body>
</html>`;
}

function loginPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>后台登录</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f6f8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2329; }
    .panel { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #e7e9ee; border-radius: 10px; padding: 28px; box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 18px; font-size: 22px; }
    label { display: block; color: #4b5563; font-size: 13px; margin-bottom: 8px; }
    input { width: 100%; border: 1px solid #d7dce5; border-radius: 6px; font: inherit; padding: 11px 12px; }
    .field + .field { margin-top: 16px; }
    button { width: 100%; border: 0; border-radius: 6px; cursor: pointer; font: inherit; font-weight: 600; margin-top: 20px; padding: 11px 16px; background: #1677ff; color: #fff; }
    .hint { color: #6b7280; font-size: 13px; line-height: 1.6; margin-top: 14px; }
    .error { color: #c23a2b; font-size: 13px; margin-top: 12px; min-height: 18px; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>后台登录</h1>
    <div class="field">
      <label for="username">用户名</label>
      <input id="username" autocomplete="username" placeholder="请输入用户名">
    </div>
    <div class="field">
      <label for="password">密码</label>
      <input id="password" type="password" autocomplete="current-password" placeholder="请输入密码">
    </div>
    <button onclick="login()">登录</button>
    <div id="error" class="error"></div>
  </div>
  <script>
    async function login() {
      const username = document.querySelector('#username').value.trim();
      const password = document.querySelector('#password').value;
      const errorBox = document.querySelector('#error');
      errorBox.textContent = '';
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorBox.textContent = data.message || '登录失败';
        return;
      }
      location.href = '/admin';
    }
    document.querySelector('#password').addEventListener('keydown', event => {
      if (event.key === 'Enter') login();
    });
  </script>
</body>
</html>`;
}

function adminHomePage() {
  return htmlShell("任务后台", `
    <section class="nav-card">
      <a href="/admin/settings">
        <article>
          <h2 style="margin-top:0;">前端页面设置</h2>
          <p class="muted">配置小程序顶部说明、任务卡片、上传表单标题、字段名和提交提示。</p>
        </article>
      </a>
      <a href="/admin/review">
        <article>
          <h2 style="margin-top:0;">审核页面</h2>
          <p class="muted">查看用户提交的游戏ID截图、订单截图、充值视频，并通过或驳回。</p>
        </article>
      </a>
    </section>
  `);
}

function settingsPage() {
  return htmlShell("前端页面设置", `
    <section class="settings">
      <h2 style="margin:0;font-size:18px;">小程序前端信息</h2>
      <div>
        <label>项目名称列表</label>
        <div id="projectsList" class="project-list"></div>
        <div class="actions">
          <input id="newProjectName" placeholder="请输入新项目名称">
          <button class="secondary" onclick="addProject()">添加项目</button>
        </div>
      </div>
      <div class="settings-grid">
        <div>
          <label for="projectName">默认项目名称</label>
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
      <h2 style="margin:8px 0 0;font-size:18px;">提交表单配置</h2>
      <div class="settings-grid">
        <div>
          <label for="formDesc">任务卡片描述</label>
          <input id="formDesc" placeholder="上传萱桦ID截图，订单截图，充值视频">
        </div>
        <div>
          <label for="gameIdImageTitle">游戏ID截图标题</label>
          <input id="gameIdImageTitle">
        </div>
        <div>
          <label for="gameIdFieldLabel">游戏ID字段名</label>
          <input id="gameIdFieldLabel">
        </div>
      </div>
      <div>
        <label for="gameIdImageTip">游戏ID截图说明</label>
        <textarea id="gameIdImageTip" rows="2"></textarea>
      </div>
      <div class="settings-grid">
        <div>
          <label for="orderImageTitle">订单截图标题</label>
          <input id="orderImageTitle">
        </div>
        <div>
          <label for="orderFieldLabel">订单字段名</label>
          <input id="orderFieldLabel">
        </div>
        <div>
          <label for="videoTitle">视频标题</label>
          <input id="videoTitle">
        </div>
      </div>
      <div>
        <label for="orderImageTip">订单截图说明</label>
        <textarea id="orderImageTip" rows="2"></textarea>
      </div>
      <div class="settings-grid">
        <div>
          <label for="submitButtonText">提交按钮文案</label>
          <input id="submitButtonText">
        </div>
        <div>
          <label for="submitTip">提交授权提示</label>
          <input id="submitTip">
        </div>
      </div>
      <div>
        <button class="primary" onclick="saveSettings()">保存前端信息</button>
      </div>
    </section>
  `, `
    const statusText = ${statusText.toString()};
    let projects = [];
    async function request(url, options) {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '请求失败');
      return data;
    }
    async function loadData() {
      const settings = await request('/api/settings');
      projects = Array.isArray(settings.projects) ? settings.projects : [];
      document.querySelector('#projectName').value = settings.projectName || '';
      document.querySelector('#amountText').value = settings.amountText || '';
      document.querySelector('#sectionTitle').value = settings.sectionTitle || '';
      document.querySelector('#content').value = settings.content || '';
      document.querySelector('#stepsText').value = settings.stepsText || '';
      document.querySelector('#warningsText').value = settings.warningsText || '';
      document.querySelector('#requiredMaterialsText').value = settings.requiredMaterialsText || '';
      document.querySelector('#formDesc').value = settings.formDesc || '';
      document.querySelector('#gameIdImageTitle').value = settings.gameIdImageTitle || '';
      document.querySelector('#gameIdImageTip').value = settings.gameIdImageTip || '';
      document.querySelector('#gameIdFieldLabel').value = settings.gameIdFieldLabel || '';
      document.querySelector('#orderImageTitle').value = settings.orderImageTitle || '';
      document.querySelector('#orderImageTip').value = settings.orderImageTip || '';
      document.querySelector('#orderFieldLabel').value = settings.orderFieldLabel || '';
      document.querySelector('#videoTitle').value = settings.videoTitle || '';
      document.querySelector('#submitButtonText').value = settings.submitButtonText || '';
      document.querySelector('#submitTip').value = settings.submitTip || '';
      renderProjects();
    }
    function renderProjects() {
      const list = document.querySelector('#projectsList');
      if (!projects.length) {
        list.innerHTML = '<div class="empty">暂无项目，请先添加项目名称</div>';
        return;
      }
      list.innerHTML = projects.map(item => \`
        <div class="project-row">
          <input value="\${escapeHtml(item.name)}" data-id="\${escapeHtml(item.id)}" oninput="updateProjectName('\${escapeJs(item.id)}', this.value)">
          <button class="secondary" onclick="setDefaultProject('\${escapeJs(item.id)}')">设为默认</button>
          <button class="danger" onclick="deleteProject('\${escapeJs(item.id)}')">删除</button>
        </div>
      \`).join('');
    }
    function addProject() {
      const input = document.querySelector('#newProjectName');
      const name = input.value.trim();
      if (!name) return;
      projects.push({ id: 'project_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name });
      if (!document.querySelector('#projectName').value.trim()) {
        document.querySelector('#projectName').value = name;
      }
      input.value = '';
      renderProjects();
    }
    function updateProjectName(id, name) {
      projects = projects.map(item => item.id === id ? { ...item, name } : item);
    }
    function setDefaultProject(id) {
      const target = projects.find(item => item.id === id);
      if (target) document.querySelector('#projectName').value = target.name;
    }
    function deleteProject(id) {
      if (!confirm('确定删除这个项目名称吗？')) return;
      projects = projects.filter(item => item.id !== id);
      const current = document.querySelector('#projectName').value.trim();
      if (!projects.some(item => item.name === current)) {
        document.querySelector('#projectName').value = projects[0] ? projects[0].name : '';
      }
      renderProjects();
    }
    async function saveSettings() {
      const cleanProjects = projects
        .map(item => ({ id: item.id, name: String(item.name || '').trim() }))
        .filter(item => item.name);
      const defaultProjectName = document.querySelector('#projectName').value.trim();
      if (defaultProjectName && !cleanProjects.some(item => item.name === defaultProjectName)) {
        cleanProjects.unshift({
          id: 'project_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          name: defaultProjectName
        });
      }
      await request('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: defaultProjectName,
          projects: cleanProjects,
          amountText: document.querySelector('#amountText').value,
          sectionTitle: document.querySelector('#sectionTitle').value,
          content: document.querySelector('#content').value,
          stepsText: document.querySelector('#stepsText').value,
          warningsText: document.querySelector('#warningsText').value,
          requiredMaterialsText: document.querySelector('#requiredMaterialsText').value,
          formDesc: document.querySelector('#formDesc').value,
          gameIdImageTitle: document.querySelector('#gameIdImageTitle').value,
          gameIdImageTip: document.querySelector('#gameIdImageTip').value,
          gameIdFieldLabel: document.querySelector('#gameIdFieldLabel').value,
          orderImageTitle: document.querySelector('#orderImageTitle').value,
          orderImageTip: document.querySelector('#orderImageTip').value,
          orderFieldLabel: document.querySelector('#orderFieldLabel').value,
          videoTitle: document.querySelector('#videoTitle').value,
          submitButtonText: document.querySelector('#submitButtonText').value,
          submitTip: document.querySelector('#submitTip').value
        })
      });
      alert('已保存');
      loadData();
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
    }
    function escapeJs(value) {
      return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
    }
    loadData().catch(error => alert(error.message));
  `);
}

function reviewPage() {
  return htmlShell("订单审核", `
    <div class="toolbar">
      <h2 style="margin:0;font-size:18px;">用户订单列表</h2>
      <button class="secondary" onclick="loadData()">刷新</button>
    </div>
    <section class="filter-panel">
      <div class="filter-grid">
        <div>
          <label for="statusFilter">审核状态</label>
          <select id="statusFilter" onchange="loadData()">
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="rejected">已拒绝</option>
            <option value="approved">已通过</option>
          </select>
        </div>
        <div>
          <label for="startDate">开始时间</label>
          <input id="startDate" type="date" onchange="loadData()">
        </div>
        <div>
          <label for="endDate">结束时间</label>
          <input id="endDate" type="date" onchange="loadData()">
        </div>
        <div class="filter-actions">
          <button class="primary" onclick="loadData()">筛选</button>
          <button class="secondary" onclick="resetFilters()">重置</button>
        </div>
      </div>
    </section>
    <div id="stats" class="stats-grid">
      <section class="stat-card stat-pending">
        <div class="stat-label">待审核</div>
        <div class="stat-value" id="pendingCount">0</div>
      </section>
      <section class="stat-card stat-rejected">
        <div class="stat-label">已拒绝</div>
        <div class="stat-value" id="rejectedCount">0</div>
      </section>
      <section class="stat-card stat-approved">
        <div class="stat-label">已通过</div>
        <div class="stat-value" id="approvedCount">0</div>
      </section>
    </div>
    <div id="list" class="list"></div>
  `, `
    const statusText = ${statusText.toString()};
    async function request(url, options) {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '请求失败');
      return data;
    }
    function sortSubmissions(submissions) {
      return submissions.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    }
    function getFilters() {
      return {
        status: document.querySelector('#statusFilter').value,
        startDate: document.querySelector('#startDate').value,
        endDate: document.querySelector('#endDate').value
      };
    }
    function applyFilters(submissions, filters) {
      const startAt = filters.startDate ? new Date(filters.startDate + 'T00:00:00').getTime() : 0;
      const endAt = filters.endDate ? new Date(filters.endDate + 'T23:59:59.999').getTime() : Infinity;
      return submissions.filter(item => {
        const createdAt = Number(item.createdAt || 0);
        if (filters.status && (item.status || 'pending') !== filters.status) return false;
        if (createdAt < startAt || createdAt > endAt) return false;
        return true;
      });
    }
    function syncUrl(filters) {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      const next = params.toString() ? '/admin/review?' + params.toString() : '/admin/review';
      history.replaceState(null, '', next);
    }
    function readUrlFilters() {
      const params = new URLSearchParams(location.search);
      document.querySelector('#statusFilter').value = params.get('status') || '';
      document.querySelector('#startDate').value = params.get('startDate') || '';
      document.querySelector('#endDate').value = params.get('endDate') || '';
    }
    function resetFilters() {
      document.querySelector('#statusFilter').value = '';
      document.querySelector('#startDate').value = '';
      document.querySelector('#endDate').value = '';
      loadData();
    }
    function updateStats(submissions) {
      const stats = submissions.reduce((acc, item) => {
        const status = item.status || 'pending';
        if (typeof acc[status] !== 'number') acc[status] = 0;
        acc[status] += 1;
        return acc;
      }, { pending: 0, rejected: 0, approved: 0 });
      document.querySelector('#pendingCount').textContent = stats.pending;
      document.querySelector('#rejectedCount').textContent = stats.rejected;
      document.querySelector('#approvedCount').textContent = stats.approved;
    }
    async function loadData() {
      const submissions = await request('/api/admin/submissions');
      const filters = getFilters();
      syncUrl(filters);
      const filtered = applyFilters(submissions, filters);
      updateStats(filtered);
      const records = sortSubmissions(filtered);
      const list = document.querySelector('#list');
      if (!records.length) {
        list.innerHTML = '<section class="empty">暂无符合条件的提交资料</section>';
        return;
      }
      const filterQuery = new URLSearchParams();
      if (filters.status) filterQuery.set('status', filters.status);
      if (filters.startDate) filterQuery.set('startDate', filters.startDate);
      if (filters.endDate) filterQuery.set('endDate', filters.endDate);
      const filterSuffix = filterQuery.toString() ? '&' + filterQuery.toString() : '';
      list.innerHTML = records.map(item => \`
        <article>
          <div class="record-head">
            <div>
              <div class="title">用户ID：\${escapeHtml(item.gameId || item.xuanhuaId || '未识别用户')}</div>
              <div class="muted">项目：\${escapeHtml(item.projectName || item.taskTitle || '-')}</div>
              <div class="muted">订单号：\${escapeHtml(item.orderNo || '-')} · 提交时间：\${item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="status \${item.status || 'pending'}">\${statusText(item.status)}</div>
              <a class="primary" style="text-decoration:none;" href="/admin/review-detail?submissionId=\${encodeURIComponent(item.id)}\${filterSuffix}">查看详情</a>
            </div>
          </div>
        </article>
      \`).join('');
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
    }
    readUrlFilters();
    loadData().catch(error => alert(error.message));
  `);
}

function reviewDetailPage(submissionId, filters = {}) {
  const safeSubmissionId = String(submissionId || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
  const backParams = new URLSearchParams();
  if (filters.status) backParams.set("status", filters.status);
  if (filters.startDate) backParams.set("startDate", filters.startDate);
  if (filters.endDate) backParams.set("endDate", filters.endDate);
  const backUrl = `/admin/review${backParams.toString() ? `?${backParams.toString()}` : ""}`;
  const filterSummary = [
    filters.status ? `状态：${statusText(filters.status)}` : "",
    filters.startDate ? `开始：${filters.startDate}` : "",
    filters.endDate ? `结束：${filters.endDate}` : ""
  ].filter(Boolean).join(" · ");
  return htmlShell("审核详情", `
    <div class="toolbar">
      <h2 style="margin:0;font-size:18px;">订单详情</h2>
      <a class="secondary" style="text-decoration:none;" href="${backUrl}">返回列表</a>
      <button class="secondary" onclick="loadData()">刷新</button>
    </div>
    ${filterSummary ? `<section class="filter-panel"><div class="muted">当前筛选：${filterSummary}</div></section>` : ""}
    <div id="list" class="list"></div>
  `, `
    const statusText = ${statusText.toString()};
    const filters = ${JSON.stringify({
      status: filters.status || "",
      startDate: filters.startDate || "",
      endDate: filters.endDate || ""
    })};
    async function request(url, options) {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '请求失败');
      return data;
    }
    function applyFilters(submissions) {
      const startAt = filters.startDate ? new Date(filters.startDate + 'T00:00:00').getTime() : 0;
      const endAt = filters.endDate ? new Date(filters.endDate + 'T23:59:59.999').getTime() : Infinity;
      return submissions.filter(item => {
        const createdAt = Number(item.createdAt || 0);
        if (filters.status && (item.status || 'pending') !== filters.status) return false;
        if (createdAt < startAt || createdAt > endAt) return false;
        return true;
      });
    }
    async function loadData() {
      const submissions = applyFilters(await request('/api/admin/submissions?submissionId=${encodeURIComponent(submissionId || "")}'));
      const list = document.querySelector('#list');
      if (!submissions.length) {
        list.innerHTML = '<section class="empty">未找到该订单，或该订单不符合当前筛选条件</section>';
        return;
      }
      list.innerHTML = submissions.map(item => \`
        <article>
          <div class="record-head">
            <div>
              <div class="title">\${escapeHtml(item.projectName || item.taskTitle || '')}</div>
              <div class="muted">提交时间：\${new Date(item.createdAt).toLocaleString()}</div>
            </div>
            <div class="status \${item.status || 'pending'}">\${statusText(item.status)}</div>
          </div>
          <div class="grid">
            <div>
              <div class="field-grid">
                <div class="field-line"><div class="field-name">项目名称</div><div class="field-value">\${escapeHtml(item.projectName || item.taskTitle || '')}</div></div>
                <div class="field-line"><div class="field-name">用户名</div><div class="field-value">\${escapeHtml(item.gameId || '')}</div></div>
                <div class="field-line"><div class="field-name">订单号</div><div class="field-value">\${escapeHtml(item.orderNo || '')}</div></div>
                <div class="field-line"><div class="field-name">提交ID</div><div class="field-value">\${escapeHtml(item.id || '')}</div></div>
              </div>
              <div class="asset-title">资料预览</div>
              <div class="asset-grid">
                \${item.gameIdImageUrl ? '<img src="' + item.gameIdImageUrl + '" alt="用户名截图">' : ''}
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
          </div>
        </article>
      \`).join('');
    }
    async function review(id, status) {
      const reviewRemark = document.querySelector('#remark-' + id).value;
      await request('/api/admin/submissions/' + encodeURIComponent(id) + '/review', {
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
  `);
}

function withVideoUrl(req, item) {
  return {
    ...item,
    videoUrl: item.videoFile ? `${publicBaseUrl(req)}/uploads/${encodeURIComponent(item.videoFile)}` : ""
  };
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    || (req.socket && req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORT}`)
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function withAssetUrls(req, item) {
  const assetUrl = file => {
    if (!file) {
      return "";
    }
    if (/^https?:\/\//i.test(file)) {
      return file;
    }
    return `${publicBaseUrl(req)}/uploads/${encodeURIComponent(file)}`;
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
  if (req.method === "GET" && url.pathname === "/admin/login") {
    if (isAdminAuthed(req)) {
      redirect(res, "/admin");
    } else {
      sendHtml(res, loginPage());
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/logout") {
    clearAdminSession(req);
    clearAdminCookie(res);
    redirect(res, "/admin/login");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      sendJson(res, 401, { message: "用户名或密码错误" });
      return;
    }
    const token = makeAdminSession();
    setAdminCookie(res, token);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    clearAdminSession(req);
    clearAdminCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname.startsWith("/admin/") || url.pathname === "/admin") {
    if (!isAdminAuthed(req)) {
      redirect(res, "/admin/login");
      return;
    }
  }
  if (req.method === "GET" && url.pathname === "/admin") {
    sendHtml(res, adminHomePage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/settings") {
    sendHtml(res, settingsPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/review") {
    sendHtml(res, reviewPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/review-detail") {
    sendHtml(res, reviewDetailPage(url.searchParams.get("submissionId") || "", {
      status: url.searchParams.get("status") || "",
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || ""
    }));
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
  if (req.method === "GET" && url.pathname === "/api/admin/submissions") {
    if (!isAdminAuthed(req)) {
      sendJson(res, 401, { message: "请先登录" });
      return;
    }
    const xuanhuaId = url.searchParams.get("xuanhuaId");
    const submissionId = url.searchParams.get("submissionId");
    const db = readDb();
    const list = submissionId
      ? db.submissions.filter(item => item.id === submissionId)
      : xuanhuaId
      ? db.submissions.filter(item => item.gameId === xuanhuaId || item.xuanhuaId === xuanhuaId)
      : db.submissions;
    sendJson(res, 200, list.map(item => withAssetUrls(req, item)));
    return;
  }
  const adminReviewMatch = /^\/api\/admin\/submissions\/([^/]+)\/review$/.exec(url.pathname);
  if (req.method === "POST" && adminReviewMatch) {
    if (!isAdminAuthed(req)) {
      sendJson(res, 401, { message: "请先登录" });
      return;
    }
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const db = readDb();
    const target = db.submissions.find(item => item.id === adminReviewMatch[1]);
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
    let recognizeError = "";
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
        url: `${publicBaseUrl(req)}/uploads/${encodeURIComponent(fileName)}`
      };
    }
    if (kind === "gameId" || kind === "order") {
      try {
        recognize = openaiOcr.isEnabled()
          ? await openaiOcr.recognizeImage(stored.url, kind)
          : await qiniuService.recognizeImage(stored.url, kind);
      } catch (error) {
        recognizeError = error.message || "OCR识别失败";
        console.error("OCR识别失败：", error.message);
      }
    }
    sendJson(res, 201, {
      fileId: stored.url,
      key: stored.key,
      url: stored.url,
      recognize,
      recognizeError
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    if (!isAdminAuthed(req)) {
      sendJson(res, 401, { message: "请先登录" });
      return;
    }
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const db = readDb();
    db.settings = normalizeSettings({
      ...db.settings,
      projectName: String(body.projectName || "").trim() || defaultDb.settings.projectName,
      projects: Array.isArray(body.projects)
        ? body.projects.map(item => ({
          id: String(item.id || "").trim() || `project_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: String(item.name || "").trim()
        })).filter(item => item.name)
        : db.settings.projects,
      amountText: String(body.amountText || "").trim() || defaultDb.settings.amountText,
      sectionTitle: String(body.sectionTitle || "").trim() || defaultDb.settings.sectionTitle,
      content: String(body.content || "").trim() || defaultDb.settings.content,
      stepsText: String(body.stepsText || "").trim() || defaultDb.settings.stepsText,
      warningsText: String(body.warningsText || "").trim() || defaultDb.settings.warningsText,
      requiredMaterialsText: String(body.requiredMaterialsText || "").trim() || defaultDb.settings.requiredMaterialsText,
      formDesc: String(body.formDesc || "").trim() || defaultDb.settings.formDesc,
      gameIdImageTitle: String(body.gameIdImageTitle || "").trim() || defaultDb.settings.gameIdImageTitle,
      gameIdImageTip: String(body.gameIdImageTip || "").trim() || defaultDb.settings.gameIdImageTip,
      gameIdFieldLabel: String(body.gameIdFieldLabel || "").trim() || defaultDb.settings.gameIdFieldLabel,
      orderImageTitle: String(body.orderImageTitle || "").trim() || defaultDb.settings.orderImageTitle,
      orderImageTip: String(body.orderImageTip || "").trim() || defaultDb.settings.orderImageTip,
      orderFieldLabel: String(body.orderFieldLabel || "").trim() || defaultDb.settings.orderFieldLabel,
      videoTitle: String(body.videoTitle || "").trim() || defaultDb.settings.videoTitle,
      submitButtonText: String(body.submitButtonText || "").trim() || defaultDb.settings.submitButtonText,
      submitTip: String(body.submitTip || "").trim() || defaultDb.settings.submitTip,
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
      projectId: String(body.projectId || "").trim(),
      projectName: String(body.projectName || body.taskTitle || db.settings.projectName || "").trim(),
      taskTitle: String(body.taskTitle || body.projectName || db.settings.projectName || "").trim(),
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
    if (!isAdminAuthed(req)) {
      sendJson(res, 401, { message: "请先登录" });
      return;
    }
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

