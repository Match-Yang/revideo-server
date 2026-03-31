# Revideo Server

视频渲染、翻译与跨平台分发服务。

源平台 → 标准化资源 → 处理流水线 → 目标平台

## 一键安装

**Linux / macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.sh | bash
```

**Windows (PowerShell)：**

```powershell
iex (irm https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.ps1)
```

安装脚本会自动：
- 安装 Node.js 22+、yt-dlp、ffmpeg/ffprobe（如缺失）
- 下载对应平台的预编译包
- 注册系统服务（开机自启）
- 启动服务，端口 3001

安装完成后打开 http://localhost:3001 即可使用 Dashboard。

**卸载：**

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.sh | bash -s -- --uninstall

# Windows
iex (irm https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.ps1); Install-Revideo -Uninstall
```

<details>
<summary>手动安装</summary>

**前置依赖**

- Node.js >= 22
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org/) + ffprobe
- Chrome 或 Chromium（用于浏览器自动化发布，可选）

**步骤**

```console
git clone https://github.com/Match-Yang/revideo-server.git
cd revideo-server
npm install
npm run build
cp .env.example .env   # 编辑 .env 配置翻译 API
npm start
```

打开 http://localhost:3001。

</details>

## 开发

```console
npm install
npm run dev            # API (:3001) + Dashboard 开发服务器
npm run build          # 编译 TypeScript → dist/
npm run lint           # eslint + tsc 类型检查
```

## 配置翻译

复制 `.env.example` 到 `.env`，填写翻译服务配置。以火山引擎 Ark 为例：

```env
TRANSLATE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
TRANSLATE_MODEL=doubao-your-model-id
TRANSLATE_API_KEY_ENV=VOLCENGINE_API_KEY
VOLCENGINE_API_KEY=your-volcengine-ark-api-key
TRANSLATE_THINKING_TYPE=disabled
```

也可以在 Dashboard 的设置页面中配置。

## API

任务相关 API：

- `POST /api/jobs` — 创建任务
- `GET /api/jobs` — 任务列表
- `POST /api/sources/probe` — 探测源平台视频
- `GET /api/download/formats?url=<url>` — 获取下载格式
- `GET /api/browser/status` — 浏览器状态
- `POST /api/browser/start` — 启动浏览器
- `GET /api/translate/providers` — 翻译服务

## License

MIT
