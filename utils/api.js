const API_BASE = "https://video.heshan1.shop";

function errorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  return error.message || error.errMsg || fallback;
}

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      header: options.header || {},
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && res.data.message) || "请求失败"));
        }
      },
      fail: error => reject(new Error(errorMessage(error, "网络请求失败")))
    });
  });
}

function requestSettings() {
  return request({
    url: "/api/settings"
  });
}

function requestTask() {
  return request({
    url: "/api/task"
  });
}

function uploadAsset(input) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE}/api/files?kind=${encodeURIComponent(input.kind || "asset")}`,
      filePath: input.filePath,
      name: "file",
      formData: {
        kind: input.kind || "asset"
      },
      success: res => {
        let data = {};
        try {
          data = JSON.parse(res.data || "{}");
        } catch (error) {
          reject(error);
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(data.message || "上传失败"));
        }
      },
      fail: error => reject(new Error(errorMessage(error, "文件上传失败，请检查网络或后台服务")))
    });
  });
}

function uploadSubmission(input) {
  return request({
    url: "/api/submissions",
    method: "POST",
    header: {
      "Content-Type": "application/json"
    },
    data: input
  });
}

function requestMySubmissions(xuanhuaId) {
  return request({
    url: `/api/submissions?xuanhuaId=${encodeURIComponent(xuanhuaId || "")}`
  });
}

module.exports = {
  API_BASE,
  requestSettings,
  requestTask,
  uploadAsset,
  uploadSubmission,
  requestMySubmissions
};
