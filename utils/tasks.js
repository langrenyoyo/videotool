const { getProject } = require("./project");

const tasks = {
  qf4M84e: {
    code: "qf4M84e",
    title: "舒缓伴侣后续",
    sectionTitle: "重点内容",
    updatedAt: "2026-04-29 09:43",
    amountText: "6元",
    content:
      "后续任务要求：从小窗显示 APP 开始录屏，下载充值软件并打开进行充值，充值金额为 6 元或充足 6 元。充值完成后结束录屏，上传 ID、充值视频。",
    steps: [
      "打开 APP，并从小窗显示开始录屏",
      "按任务要求完成充值操作",
      "充值完成后停止录屏",
      "在提交页填写 ID 并上传充值视频"
    ],
    warnings: [
      "请勿上传含支付密码、验证码、身份证号等敏感信息的视频",
      "仅提交任务要求所需信息，确认无误后再提交"
    ],
    requiredMaterials: [
      "ID",
      "充值完成后的录屏视频"
    ],
    form: {
      desc: "上传ID截图，订单截图，充值视频",
      gameIdImageTitle: "id截图",
      gameIdImageTip: "请正面拍摄，要求内容清晰完整，方便AI识别",
      gameIdFieldLabel: "ID",
      orderImageTitle: "订单截图",
      orderImageTip: "请正面拍摄，要求内容清晰完整，方便AI识别",
      orderFieldLabel: "订单号",
      videoTitle: "充值视频",
      submitButtonText: "提交",
      submitTip: "提交即授权该表单收集你填写的信息，查看详情"
    }
  }
};

function getTask(code) {
  const task = tasks[code] || tasks.qf4M84e;
  const project = getProject();
  return {
    ...task,
    title: project.name || task.title
  };
}

module.exports = {
  tasks,
  getTask
};
