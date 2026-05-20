const { requestMySubmissions } = require("../../utils/api");

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusText(status) {
  const map = {
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回"
  };
  return map[status] || "待审核";
}

Page({
  data: {
    records: [],
    gameId: ""
  },

  onLoad(query) {
    this.setData({
      gameId: query.gameId || query.xuanhuaId || ""
    });
  },

  onShow() {
    if (!this.data.gameId) {
      this.setData({ records: [] });
      return;
    }
    requestMySubmissions(this.data.gameId)
      .then(records => {
        this.setData({
          records: records.map(item => ({
            ...item,
            statusText: statusText(item.status),
            createdAtText: formatTime(item.createdAt)
          }))
        });
      })
      .catch(() => {
        this.setData({ records: [] });
      });
  },

  goTask() {
    wx.redirectTo({
      url: "/pages/task/detail?code=qf4M84e"
    });
  }
});
