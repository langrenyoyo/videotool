const { getTask } = require("../../utils/tasks");
const { requestTask, uploadAsset, uploadSubmission, reportClientError } = require("../../utils/api");
const { validateSubmission } = require("../../utils/submissions");

Page({
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
    recognizingGameId: false,
    recognizingOrder: false,
    videoUploading: false,
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
    this.pickVideo("camera");
  },

  chooseVideoFromAlbum() {
    this.pickVideo("album");
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
        this.setData({
          [pathKey]: file.tempFilePath
        });
        this.compressImage(file.tempFilePath)
          .then(compressedPath => {
            this.setData({
              [pathKey]: compressedPath
            });
            this.uploadAndMockRecognize(kind, compressedPath);
          })
          .catch(() => {
            this.uploadAndMockRecognize(kind, file.tempFilePath);
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

  pickVideo(sourceType) {
    const failMessages = [];
    const onSuccess = filePath => {
      if (!filePath) {
        wx.showToast({
          title: "未获取到视频",
          icon: "none"
        });
        return;
      }
      this.setData({
        videoPath: filePath,
        videoFileId: "",
        videoUploading: true,
        videoUploadError: ""
      });
      uploadAsset({
        kind: "video",
        filePath
      }).then(data => {
        this.setData({
          videoFileId: data.fileId || "",
          videoUploading: false,
          videoUploadError: data.fileId ? "" : "视频上传未返回文件ID"
        });
      }).catch(error => {
        this.setData({
          videoFileId: "",
          videoUploading: false,
          videoUploadError: error.message || "视频上传失败"
        });
        wx.showToast({
          title: error.message || "视频上传失败",
          icon: "none"
        });
      });
    };
    const isCancel = error => {
      const message = error && (error.errMsg || error.message) || "";
      return /cancel/i.test(message);
    };
    const rememberFail = error => {
      const message = error && (error.errMsg || error.message) || "未知错误";
      failMessages.push(message);
      console.warn("[pickVideo]", sourceType, message);
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

  uploadAndMockRecognize(kind, filePath) {
    const recognizingKey = kind === "order" ? "recognizingOrder" : "recognizingGameId";
    this.setData({ [recognizingKey]: true });
    uploadAsset({
      kind,
      filePath
    })
      .then(data => {
        const fileIdKey = kind === "order" ? "orderImageFileId" : "gameIdImageFileId";
        const recognize = data.recognize || {};
        const next = {
          [fileIdKey]: data.fileId || ""
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
        wx.showToast({
          title: error.message || "AI识别失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ [recognizingKey]: false });
      });
  },

  submit() {
    if (this.data.videoUploading) {
      wx.showToast({
        title: "视频正在上传，请稍后提交",
        icon: "none"
      });
      return;
    }
    if (this.data.videoPath && !this.data.videoFileId) {
      wx.showToast({
        title: this.data.videoUploadError || "视频未上传成功，请重新选择视频",
        icon: "none"
      });
      return;
    }
    const input = {
      taskCode: this.data.task.code,
      projectId: this.data.selectedProjectId,
      projectName: this.data.selectedProjectName,
      taskTitle: this.data.selectedProjectName || this.data.task.title,
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
