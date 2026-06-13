# 任务提交小程序

这是一个原生微信小程序原型，用于展示后台配置的任务说明、填写 ID、选择充值录屏视频，并提交到独立后台审核。

## 页面

- `pages/task/detail`：任务详情页，从后台读取项目名称、金额标签、重点内容、步骤和提醒。
- `pages/submit/submit`：任务提交页，填写 ID 并选择视频。
- `pages/records/records`：提交记录页，按 ID 查询后台审核状态。
- `server/server.js`：独立 Web 后台和接口服务，可配置小程序前端信息、接收视频上传、查看资料、填写审核备注、通过或驳回提交。

## 本地运行

先启动独立后台服务：

```bash
npm install
node server/server.js
```

后台地址：

```text
http://127.0.0.1:3000/admin
```

小程序接口默认连接：

```text
http://127.0.0.1:3000
```

再打开小程序：

1. 使用微信开发者工具打开本目录：`D:\AI\wxxcx`
2. 编译模式选择小程序。
3. 入口页面可使用：`pages/task/detail?code=qf4M84e`

## 测试

```bash
node tests/smoke.test.js
```

当前测试覆盖：

- 小程序页面配置和文件完整性。
- 任务数据读取。
- 提交表单校验。
- 提交对象生成。
- 本地工具函数的保存、读取和清空。
- 项目名称保存。
- 后台任务配置转换为小程序展示数据。
- 审核状态更新。
- 后台服务文件存在。
- 后台未混入小程序页面配置。

## 当前边界

当前版本已把用户小程序和审核后台分离。配置七牛云后，图片和视频会上传到七牛云；未配置七牛云时会自动回退到本机 `server/uploads/`。后台数据保存在本机 `server/data/db.json`。若要上线，需要部署后端服务、配置正式域名和 HTTPS，并增加后台登录鉴权。

## 七牛云配置

复制 `.env.example` 为 `.env`，填写：

```text
QINIU_ACCESS_KEY=七牛AK
QINIU_SECRET_KEY=七牛SK
QINIU_BUCKET=空间名
QINIU_DOMAIN=https://你的七牛CDN域名
QINIU_REGION=z0
QINIU_AI_API_KEY=七牛AI接口Key
OPENAI_API_KEY=OpenAI API Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_OCR_MODEL=gpt-4.1-mini
```

图片 OCR 优先使用 `OPENAI_API_KEY`。没有配置 OpenAI 时，才尝试使用 `QINIU_AI_API_KEY`。两个都没有配置时只上传文件，不自动识别。
