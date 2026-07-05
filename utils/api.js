const API_BASE = "https://video.heshan1.shop";
const BUILD_TAG = "dual-video-20260706";

function errorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  return error.message || error.errMsg || fallback;
}

function makeRequestError(message, detail) {
  const error = new Error(message || "Request failed");
  Object.assign(error, detail || {});
  return error;
}

function request(options) {
  const fullUrl = `${API_BASE}${options.url}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method: options.method || "GET",
      data: options.data || {},
      header: options.header || {},
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(makeRequestError((res.data && res.data.message) || "Request failed", {
            statusCode: res.statusCode,
            responseData: res.data,
            url: fullUrl
          }));
        }
      },
      fail: error => reject(makeRequestError(errorMessage(error, "Network request failed"), {
        errMsg: error && error.errMsg || "",
        url: fullUrl
      }))
    });
  });
}

function reportClientError(input) {
  return request({
    url: "/api/client-logs",
    method: "POST",
    header: {
      "Content-Type": "application/json"
    },
    data: {
      apiBase: API_BASE,
      buildTag: BUILD_TAG,
      ...input
    }
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
    const uploadUrl = `${API_BASE}/api/files?kind=${encodeURIComponent(input.kind || "asset")}`;
    console.log("[uploadAsset]", BUILD_TAG, uploadUrl);
    wx.uploadFile({
      url: uploadUrl,
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
          reject(makeRequestError(error.message || "Upload response parse failed", {
            statusCode: res.statusCode,
            url: uploadUrl
          }));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(makeRequestError(data.message || "Upload failed", {
            statusCode: res.statusCode,
            responseData: data,
            url: uploadUrl
          }));
        }
      },
      fail: error => {
        const message = errorMessage(error, "File upload failed, check network or backend service");
        if (/domain/i.test(message)) {
          reject(makeRequestError(`Upload domain not valid: ${API_BASE}`, {
            errMsg: message,
            url: uploadUrl
          }));
          return;
        }
        reject(makeRequestError(`${message}: ${uploadUrl}`, {
          errMsg: error && error.errMsg || "",
          url: uploadUrl
        }));
      }
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
  BUILD_TAG,
  requestSettings,
  requestTask,
  uploadAsset,
  uploadSubmission,
  reportClientError,
  requestMySubmissions
};
