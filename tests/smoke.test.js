const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

const appJson = readJson("app.json");
assert.deepStrictEqual(appJson.pages, [
  "pages/submit/submit",
  "pages/task/detail",
  "pages/records/records"
]);

for (const page of appJson.pages) {
  for (const ext of [".js", ".json", ".wxml", ".wxss"]) {
    assert.ok(fs.existsSync(path.join(root, `${page}${ext}`)), `${page}${ext} should exist`);
  }
}

const { getTask } = require("../utils/tasks");
const {
  clearProject,
  getProject,
  saveProject
} = require("../utils/project");
const {
  createSubmission,
  clearSubmissions,
  listSubmissions,
  saveSubmission,
  updateSubmissionStatus,
  validateSubmission
} = require("../utils/submissions");

const task = getTask("qf4M84e");
assert.strictEqual(task.title, "XXXX后续");
assert.ok(task.steps.length >= 4);

assert.strictEqual(validateSubmission({ gameId: "", orderNo: "NO1", gameIdImagePath: "/tmp/a.jpg", orderImagePath: "/tmp/b.jpg", videoPath: "/tmp/a.mp4" }), "请填写游戏ID");
assert.strictEqual(validateSubmission({ gameId: "XH001", orderNo: "", gameIdImagePath: "/tmp/a.jpg", orderImagePath: "/tmp/b.jpg", videoPath: "/tmp/a.mp4" }), "请填写订单号");
assert.strictEqual(validateSubmission({ gameId: "XH001", orderNo: "NO1", gameIdImagePath: "", orderImagePath: "/tmp/b.jpg", videoPath: "/tmp/a.mp4" }), "请上传id截图");
assert.strictEqual(validateSubmission({ gameId: "XH001", orderNo: "NO1", gameIdImagePath: "/tmp/a.jpg", orderImagePath: "", videoPath: "/tmp/a.mp4" }), "请上传订单截图");
assert.strictEqual(validateSubmission({ gameId: "XH001", orderNo: "NO1", gameIdImagePath: "/tmp/a.jpg", orderImagePath: "/tmp/b.jpg", videoPath: "" }), "请上传充值视频");
assert.strictEqual(validateSubmission({ gameId: "XH001", orderNo: "NO1", gameIdImagePath: "/tmp/a.jpg", orderImagePath: "/tmp/b.jpg", videoPath: "/tmp/a.mp4" }), "ID截图未上传成功，请重新选择");
assert.strictEqual(validateSubmission({
  gameId: "XH001",
  orderNo: "NO1",
  gameIdImagePath: "/tmp/a.jpg",
  orderImagePath: "/tmp/b.jpg",
  videoPath: "/tmp/a.mp4",
  gameIdImageFileId: "a.jpg",
  orderImageFileId: "b.jpg",
  videoFileId: "c.mp4"
}), "");

const submission = createSubmission({
  taskCode: task.code,
  taskTitle: task.title,
  gameId: " XH001 ",
  orderNo: " NO123 ",
  gameIdImageFileId: "a.jpg",
  orderImageFileId: "b.jpg",
  videoFileId: "c.mp4"
});

assert.strictEqual(submission.gameId, "XH001");
assert.strictEqual(submission.orderNo, "NO123");
assert.strictEqual(submission.status, "pending");
assert.ok(submission.id.startsWith("sub_"));

const storage = {};
global.wx = {
  getStorageSync(key) {
    return storage[key];
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  }
};

clearSubmissions();
clearProject();
assert.deepStrictEqual(listSubmissions(), []);
saveSubmission(submission);
const saved = listSubmissions();
assert.strictEqual(saved.length, 1);
assert.strictEqual(saved[0].gameId, "XH001");

const approved = updateSubmissionStatus(submission.id, "approved", "资料清晰");
assert.strictEqual(approved.status, "approved");
assert.strictEqual(approved.reviewRemark, "资料清晰");
assert.strictEqual(listSubmissions()[0].status, "approved");

assert.strictEqual(getProject().name, "XXXX后续");
saveProject({ name: "新项目名称" });
assert.strictEqual(getProject().name, "新项目名称");
assert.strictEqual(getTask("qf4M84e").title, "新项目名称");

clearSubmissions();
clearProject();
assert.deepStrictEqual(listSubmissions(), []);

assert.ok(fs.existsSync(path.join(root, "server/server.js")), "server/server.js should exist");
assert.ok(fs.existsSync(path.join(root, "utils/api.js")), "utils/api.js should exist");
assert.ok(!appJson.pages.includes("pages/admin/admin"), "admin must not be inside miniprogram");

const { settingsToTask } = require("../server/server");
const { extractFields } = require("../server/qiniu-service");
const openaiOcr = require("../server/openai-ocr");
const remoteTask = settingsToTask({
  projectName: "后台项目",
  taskCode: "abc123",
  sectionTitle: "后台内容",
  updatedAt: "2026-05-19 21:30",
  amountText: "10元",
  content: "后台输入的任务正文",
  stepsText: "第一步\n第二步",
  warningsText: "提醒一\n提醒二",
  requiredMaterialsText: "资料一\n资料二"
});
assert.strictEqual(remoteTask.title, "后台项目");
assert.deepStrictEqual(remoteTask.steps, ["第一步", "第二步"]);
assert.deepStrictEqual(remoteTask.warnings, ["提醒一", "提醒二"]);
assert.deepStrictEqual(remoteTask.requiredMaterials, ["资料一", "资料二"]);
assert.strictEqual(extractFields("游戏ID: ABC12345", "gameId").gameId, "ABC12345");
assert.strictEqual(extractFields("用户名: 张三 ID: ABC12345", "gameId").gameId, "张三");
assert.strictEqual(extractFields("停车智管ID: ABC12345…", "gameId").gameId, "ABC12345");
assert.strictEqual(extractFields("用户ID: XY99***", "gameId").gameId, "XY99");
assert.strictEqual(extractFields("订单号: NO-987654321", "order").orderNo, "NO-987654321");
assert.strictEqual(typeof openaiOcr.isEnabled(), "boolean");

console.log("Smoke tests passed");
