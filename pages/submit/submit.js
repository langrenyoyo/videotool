const { getTask } = require("../../utils/tasks");
const { BUILD_TAG, requestTask, uploadAsset, uploadSubmission, reportClientError } = require("../../utils/api");
const { validateSubmission } = require("../../utils/submissions");

Page({
  _uploadCount: 0,
  _uploadSeq: {
    gameId: 0,
    order: 0,
    video: 0
  },

  data: {
    task: getTask("qf4M84e"),
    projects: [],
    projectNames: [],
    selectedProjectIndex: 0,
    selectedProjectId: "",
    selectedProjectName: "",
    gameIdImagePath: "",
    orderImagePath: "",
    videoPath: "",
    gameId: "",
    orderNo: "",
    gameIdImageFileId: "",
    orderImageFileId: "",
    videoFileId: "",
    assetUploading: false,
    uploadMaskText: "正在上传，请稍候",
    gameIdImageUploadError: "",
    orderImageUploadError: "",
    videoUploadError: "",
    submitting: false
  },

  onLoad(query) {
    const localTask = getTask(query.code);
    const localProjects = [{ id: "default", name: localTask.title }];
    this.setData({
      task: localTask,
      projects: localProjects,
      projectNames: localProjects.map(item => item.name),
      selectedProjectIndex: 0,
      selectedProjectId: localProjects[0].id,
      selectedProjectName: localProjects[0].name
    });
    requestTask()
      .then(task => {
        if (task && task.title) {
          const projects = Array.isArray(task.projects) && task.projects.length
            ? task.projects
            : [{ id: "default", name: task.title }];
          this.setData({
            task,
            projects,
            projectNames: projects.map(item => item.name),
            selectedProjectIndex: 0,
            selectedProjectId: projects[0].id,
            selectedProjectName: projects[0].name
          });
        }
      })
      .catch(() => {});
  },

  beginAssetUpload(text) {
    this._uploadCount += 1;
    this.setData({
      assetUploading: true,
      uploadMaskText: text || "正在上传，请稍候"
    });
  },

  endAssetUpload() {
    this._uploadCount = Math.max(0, this._uploadCount - 1);
    if (this._uploadCount === 0) {
      this.setData({ assetUploading: false });
    }
  },

  onProjectChange(event) {
    const index = Number(event.detail.value || 0);
    const project = this.data.projects[index];
    if (!project) {
      return;
    }
    this.setData({
      selectedProjectIndex: index,
      selectedProjectId: project.id,
      selectedProjectName: project.name
    });
  },

  onGameIdInput(event) {
    this.setData({ gameId: event.detail.value });
  },

  onOrderNoInput(event) {
    this.setData({ orderNo: event.detail.value });
  },

  chooseGameIdImage() {
    this.pickImage(true);
  },

  chooseGameIdFromAlbum() {
    this.pickImage(false, "album");
  },

  chooseOrderImage() {
    this.pickImage(false, null, "order");
  },

  chooseOrderFromAlbum() {
    this.pickImage(false, "album", "order");
  },

  chooseVideoFromCamera() {
    this.pickVideo("camera", "video");
  },

  chooseVideoFromAlbum() {
    this.pickVideo("album", "video");
  },

  pickImage(useCamera = false, sourceType = null, kind = "gameId") {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: sourceType ? [sourceType] : useCamera ? ["camera"] : ["album", "camera"],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          return;
        }
        const pathKey = kind === "order" ? "orderImagePath" : "gameIdImagePath";
        const fileIdKey = kind === "order" ? "orderImageFileId" : "gameIdImageFileId";
        const errorKey = kind === "order" ? "orderImageUploadError" : "gameIdImageUploadError";
        const maskText = kind === "order" ? "正在上传订单截图" : "正在上传ID截图";
        this.setData({
          [pathKey]: file.tempFilePath,
          [fileIdKey]: "",
          [errorKey]: ""
        });
        this.beginAssetUpload(maskText);
        this.compressImage(file.tempFilePath)
          .then(compressedPath => {
            this.setData({
              [pathKey]: compressedPath
            });
            this.uploadAndRecognize(kind, compressedPath);
          })
          .catch(() => {
            this.uploadAndRecognize(kind, file.tempFilePath);
          });
      }
    });
  },

  compressImage(filePath) {
    if (!wx.compressImage) {
      return Promise.resolve(filePath);
    }
    return new Promise((resolve, reject) => {
      wx.compressImage({
        src: filePath,
        quality: 55,
        success: res => resolve(res.tempFilePath || filePath),
        fail: reject
      });
    });
  },

  uploadAndRecognize(kind, filePath) {
    const seq = ++this._uploadSeq[kind];
    uploadAsset({
      kind,
      filePath
    })
      .then(data => {
        if (this._uploadSeq[kind] !== seq) {
          return;
        }
        const fileIdKey = kind === "order" ? "orderImageFileId" : "gameIdImageFileId";
        const errorKey = kind === "order" ? "orderImageUploadError" : "gameIdImageUploadError";
        const recognize = data.recognize || {};
        const next = {
          [fileIdKey]: data.fileId || "",
          [errorKey]: data.fileId ? "" : "图片上传未返回文件ID"
        };
        const gameId = recognize.gameId || recognize.username || recognize.value || "";
        const orderNo = recognize.orderNo || recognize.value || "";
        if (kind === "gameId" && gameId) {
          next.gameId = gameId;
        }
        if (kind === "order" && orderNo) {
          next.orderNo = orderNo;
        }
        this.setData(next);
        if (!data.fileId) {
          wx.showToast({
            title: next[errorKey],
            icon: "none"
          });
          return;
        }
        if (data.recognizeError) {
          wx.showToast({
            title: data.recognizeError,
            icon: "none"
          });
          return;
        }
        wx.showToast({
          title: kind === "order"
            ? (orderNo ? "已识别订单号" : "未识别到订单号")
            : (gameId ? "已识别ID" : "未识别到ID"),
          icon: "none"
        });
      })
      .catch(error => {
        if (this._uploadSeq[kind] !== seq) {
          return;
        }
        const errorKey = kind === "order" ? "orderImageUploadError" : "gameIdImageUploadError";
        const fileIdKey = kind === "order" ? "orderImageFileId" : "gameIdImageFileId";
        this.setData({
          [fileIdKey]: "",
          [errorKey]: error.message || "图片上传失败"
        });
        wx.showToast({
          title: error.message || "图片上传失败",
          icon: "none"
        });
      })
      .finally(() => {
        if (this._uploadSeq[kind] === seq) {
          this.endAssetUpload();
        }
      });
  },

  compressVideo(filePath) {
    if (!wx.compressVideo) {
      return Promise.resolve(filePath);
    }
    return new Promise(resolve => {
      wx.compressVideo({
        src: filePath,
        quality: "medium",
        success: res => resolve(res.tempFilePath || filePath),
        fail: () => resolve(filePath)
      });
    });
  },

  videoUploadConfig(kind) {
    return {
      pathKey: "videoPath",
      fileIdKey: "videoFileId",
      errorKey: "videoUploadError",
      maskText: "正在上传视频",
      missingText: "视频上传未返回文件ID",
      failText: "视频上传失败",
      successText: "视频上传成功"
    };
  },

  pickVideo(sourceType, kind = "video") {
    const config = this.videoUploadConfig(kind);
    const failMessages = [];
    const onSuccess = filePath => {
      if (!filePath) {
        wx.showToast({
          title: "未获取到视频",
          icon: "none"
        });
        return;
      }
      const seq = ++this._uploadSeq[kind];
      this.setData({
        [config.pathKey]: filePath,
        [config.fileIdKey]: "",
        [config.errorKey]: ""
      });
      this.beginAssetUpload(config.maskText);
      this.compressVideo(filePath)
        .then(uploadPath => {
          if (this._uploadSeq[kind] !== seq) {
            return Promise.reject({ stale: true });
          }
          if (uploadPath && uploadPath !== filePath) {
            this.setData({ [config.pathKey]: uploadPath });
          }
          return uploadAsset({
            kind: "video",
            filePath: uploadPath || filePath
          });
        })
        .then(data => {
          if (this._uploadSeq[kind] !== seq) {
            return;
          }
          this.setData({
            [config.fileIdKey]: data.fileId || "",
            [config.errorKey]: data.fileId ? "" : config.missingText
          });
          if (!data.fileId) {
            wx.showToast({
              title: config.missingText,
              icon: "none"
            });
            return;
          }
          wx.showToast({
            title: config.successText,
            icon: "success"
          });
        }).catch(error => {
          if (error && error.stale) {
            return;
          }
          if (this._uploadSeq[kind] !== seq) {
            return;
          }
          this.setData({
            [config.fileIdKey]: "",
            [config.errorKey]: error.message || config.failText
          });
          wx.showToast({
            title: error.message || config.failText,
            icon: "none"
          });
        }).finally(() => {
          if (this._uploadSeq[kind] === seq) {
            this.endAssetUpload();
          }
        });
    };
    const isCancel = error => {
      const message = error && (error.errMsg || error.message) || "";
      return /cancel/i.test(message);
    };
    const rememberFail = error => {
      const message = error && (error.errMsg || error.message) || "未知错误";
      failMessages.push(message);
      console.warn("[pickVideo]", kind, sourceType, message);
    };
    const showFinalFail = () => {
      const last = failMessages[failMessages.length - 1] || "";
      wx.showToast({
        title: last ? `无法选择视频：${last}` : "无法选择视频，请检查相册权限",
        icon: "none"
      });
    };

    const chooseByMedia = fallback => {
      if (!wx.chooseMedia) {
        fallback();
        return;
      }
      const options = {
        count: 1,
        mediaType: ["video"],
        sourceType: [sourceType],
        success: res => {
          const file = res.tempFiles && res.tempFiles[0];
          onSuccess(file && file.tempFilePath);
        },
        fail: error => {
          if (isCancel(error)) {
            return;
          }
          rememberFail(error);
          fallback();
        }
      };
      if (sourceType === "camera") {
        options.maxDuration = 60;
      }
      wx.chooseMedia(options);
    };

    const chooseByVideo = fallback => {
      if (!wx.chooseVideo) {
        fallback();
        return;
      }
      const options = {
        sourceType: [sourceType],
        compressed: true,
        success: res => onSuccess(res.tempFilePath),
        fail: error => {
          if (isCancel(error)) {
            return;
          }
          rememberFail(error);
          fallback();
        }
      };
      if (sourceType === "camera") {
        options.maxDuration = 60;
      }
      wx.chooseVideo(options);
    };

    if (sourceType === "album") {
      chooseByMedia(() => chooseByVideo(showFinalFail));
      return;
    }
    chooseByVideo(() => chooseByMedia(showFinalFail));
  },

  submit() {
    if (this.data.assetUploading) {
      wx.showToast({
        title: "文件正在上传，请稍后提交",
        icon: "none"
      });
      return;
    }
    const input = {
      taskCode: this.data.task.code,
      projectId: this.data.selectedProjectId,
      projectName: this.data.selectedProjectName,
      taskTitle: this.data.selectedProjectName || this.data.task.title,
      clientBuildTag: BUILD_TAG,
      gameId: this.data.gameId,
      orderNo: this.data.orderNo,
      gameIdImagePath: this.data.gameIdImagePath,
      orderImagePath: this.data.orderImagePath,
      videoPath: this.data.videoPath,
      gameIdImageFileId: this.data.gameIdImageFileId,
      orderImageFileId: this.data.orderImageFileId,
      videoFileId: this.data.videoFileId
    };
    const error = validateSubmission(input);
    if (error) {
      reportClientError({
        event: "submission-client-validation-failed",
        page: "pages/submit/submit",
        action: "submit",
        message: error,
        context: {
          taskCode: input.taskCode,
          projectId: input.projectId,
          projectName: input.projectName,
          gameId: input.gameId,
          orderNo: input.orderNo,
          hasGameIdImagePath: Boolean(input.gameIdImagePath),
          hasOrderImagePath: Boolean(input.orderImagePath),
          hasVideoPath: Boolean(input.videoPath),
          hasGameIdImageFileId: Boolean(input.gameIdImageFileId),
          hasOrderImageFileId: Boolean(input.orderImageFileId),
          hasVideoFileId: Boolean(input.videoFileId)
        }
      }).catch(() => {});
      wx.showToast({
        title: error,
        icon: "none"
      });
      return;
    }

    this.setData({ submitting: true });
    uploadSubmission(input)
      .then(() => {
        wx.showToast({
          title: "提交成功",
          icon: "success"
        });
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/records/records?gameId=${encodeURIComponent(this.data.gameId)}`
          });
        }, 600);
      })
      .catch(error => {
        reportClientError({
          event: "submission-client-failed",
          page: "pages/submit/submit",
          action: "submit",
          message: error.message || "提交失败",
          statusCode: error.statusCode || "",
          url: error.url || "",
          errMsg: error.errMsg || "",
          requestId: error.responseData && error.responseData.requestId || "",
          context: {
            taskCode: input.taskCode,
            projectId: input.projectId,
            projectName: input.projectName,
            gameId: input.gameId,
            orderNo: input.orderNo,
            hasGameIdImagePath: Boolean(input.gameIdImagePath),
            hasOrderImagePath: Boolean(input.orderImagePath),
            hasVideoPath: Boolean(input.videoPath),
            hasGameIdImageFileId: Boolean(input.gameIdImageFileId),
            hasOrderImageFileId: Boolean(input.orderImageFileId),
            hasVideoFileId: Boolean(input.videoFileId)
          }
        }).catch(() => {});
        wx.showToast({
          title: error.message || "提交失败，请检查网络或后台服务",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  }
});
