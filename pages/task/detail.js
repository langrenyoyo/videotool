const { requestTask } = require("../../utils/api");
const { getTask } = require("../../utils/tasks");

Page({
  data: {
    task: getTask("qf4M84e")
  },

  onLoad(query) {
    const task = getTask(query.code);
    this.setData({ task });
    this.loadRemoteTask();
  },

  loadRemoteTask() {
    requestTask()
      .then(task => {
        if (!task || !task.title) {
          return;
        }
        this.setData({
          task: {
            ...this.data.task,
            ...task
          }
        });
      })
      .catch(() => {});
  },

  goSubmit() {
    wx.navigateTo({
      url: `/pages/submit/submit?code=${this.data.task.code}`
    });
  },

  goRecords() {
    wx.navigateTo({
      url: "/pages/records/records"
    });
  }
});
