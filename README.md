# Revideo Server

视频渲染、翻译与跨平台分发服务。

源平台 → 标准化资源 → 处理流水线 → 目标平台

![](images/jobs.png)

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

**Linux / macOS：**
```bash
curl -fsSL https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.sh | bash -s -- --uninstall
```

**Windows (PowerShell)：**
```bash

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

在 Dashboard 的设置页面中配置 LLM：填写兼容 OpenAI API 格式的 URL、模型名称和 API Key。Thinking 默认关闭。
![](images/llm-settings.png)

## 联系我

如果有疑问或者需要技术支持的，可以联系我。

![](images/wechat.jpg)

## License

MIT
