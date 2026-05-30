const { getTask } = require("../../utils/tasks");
const { requestTask, uploadAsset, uploadSubmission } = require("../../utils/api");
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
        this.uploadAndMockRecognize(kind, file.tempFilePath);
      }
    });
  },

  pickVideo(sourceType) {
    wx.chooseMedia({
      count: 1,
      mediaType: ["video"],
      sourceType: [sourceType],
      maxDuration: 300,
      success: res => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          return;
        }
        this.setData({
          videoPath: file.tempFilePath
        });
        uploadAsset({
          kind: "video",
          filePath: file.tempFilePath
        }).then(data => {
          this.setData({ videoFileId: data.fileId || "" });
        }).catch(() => {});
      }
    });
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
            : (gameId ? "已识别用户名" : "未识别到用户名"),
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
      .catch(() => {
        wx.showToast({
          title: "提交失败，请先启动后台服务",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  }
});
