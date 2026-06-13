const STORAGE_KEY = "task_submissions";

function getWx() {
  if (typeof wx !== "undefined") {
    return wx;
  }
  return null;
}

function createSubmission(input) {
  const now = Date.now();
  return {
    id: `sub_${now}_${Math.random().toString(36).slice(2, 8)}`,
    taskCode: input.taskCode,
    taskTitle: input.taskTitle,
    xuanhuaId: String(input.gameId || input.xuanhuaId || "").trim(),
    gameIdImageFileId: input.gameIdImageFileId || "",
    orderImageFileId: input.orderImageFileId || "",
    videoFileId: input.videoFileId || "",
    gameId: String(input.gameId || "").trim(),
    orderNo: String(input.orderNo || "").trim(),
    status: "pending",
    createdAt: now
  };
}

function validateSubmission(input) {
  if (!String(input.gameId || "").trim()) {
    return "请填写游戏ID";
  }
  if (!String(input.orderNo || "").trim()) {
    return "请填写订单号";
  }
  if (!input.gameIdImagePath) {
    return "请上传id截图";
  }
  if (!input.orderImagePath) {
    return "请上传订单截图";
  }
  if (!input.videoPath) {
    return "请上传充值视频";
  }
  return "";
}

function listSubmissions() {
  const api = getWx();
  if (!api) {
    return [];
  }
  return api.getStorageSync(STORAGE_KEY) || [];
}

function saveSubmission(submission) {
  const api = getWx();
  if (!api) {
    return submission;
  }
  const list = listSubmissions();
  list.unshift(submission);
  api.setStorageSync(STORAGE_KEY, list);
  return submission;
}

function updateSubmissionStatus(id, status, reviewRemark) {
  const api = getWx();
  if (!api) {
    return null;
  }
  const list = listSubmissions();
  const index = list.findIndex(item => item.id === id);
  if (index < 0) {
    return null;
  }
  const next = {
    ...list[index],
    status,
    reviewRemark: String(reviewRemark || "").trim(),
    reviewedAt: Date.now()
  };
  list.splice(index, 1, next);
  api.setStorageSync(STORAGE_KEY, list);
  return next;
}

function clearSubmissions() {
  const api = getWx();
  if (api) {
    api.removeStorageSync(STORAGE_KEY);
  }
}

module.exports = {
  STORAGE_KEY,
  createSubmission,
  validateSubmission,
  listSubmissions,
  saveSubmission,
  updateSubmissionStatus,
  clearSubmissions
};
