# Revideo Server

Video rendering, translation, and cross-platform republishing service built on FFmpeg.

Source platform → canonical job assets → processing workflow → target platforms

## Quick Install

**Linux / macOS:**

```bash
curl -fsSL https://gitee.com/<owner>/revideo-server/raw/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
iex (irm https://gitee.com/<owner>/revideo-server/raw/main/install.ps1)
```

This will automatically:
- Install Node.js 22+, yt-dlp, ffmpeg/ffprobe (if missing)
- Download the pre-built package for your platform
- Register the server as a system service (auto-start on boot)
- Start the server on port 3001

After installation, open http://localhost:3001 to access the dashboard.

**Uninstall:**

```bash
# Linux / macOS
curl -fsSL https://gitee.com/<owner>/revideo-server/raw/main/install.sh | bash -s -- --uninstall

# Windows
iex (irm https://gitee.com/<owner>/revideo-server/raw/main/install.ps1); Install-Revideo -Uninstall
```

<details>
<summary>Manual Installation</summary>

**Prerequisites**

- Node.js >= 22
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org/) + ffprobe
- Chrome or Chromium (for browser-based publishing, optional)

**Steps**

```console
git clone https://github.com/Match-Yang/revideo-server.git
cd revideo-server
npm install
npm run build
cp .env.example .env   # then edit .env with your translation config
npm start
```

Open http://localhost:3001.

</details>

## Development

```console
npm install
npm run dev            # API on :3001 + dashboard dev server
npm run build          # compile TypeScript → dist/
npm run lint           # eslint + tsc
```

## Configure Translation

Copy `.env.example` to `.env`, then fill the provider settings. For Volcengine Ark:

```env
TRANSLATE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
TRANSLATE_MODEL=doubao-your-model-id
TRANSLATE_API_KEY_ENV=VOLCENGINE_API_KEY
VOLCENGINE_API_KEY=your-volcengine-ark-api-key
TRANSLATE_THINKING_TYPE=disabled
```

`TRANSLATE_MODEL` can be either a Volcengine Ark Model ID or an inference endpoint ID. `TRANSLATE_THINKING_TYPE=disabled` turns off Ark's thinking mode for translation calls. `ARK_API_KEY` is also supported if you prefer the variable name used in many Ark examples. Restart the server after editing `.env`.

Translation safety is handled as model review plus Chinese post-scan. Source text is not locally pre-scanned because comments and subtitles may be in any language, including normal Chinese comments.

## APIs

Legacy rendering/task APIs are documented in [docs/render-api.md](docs/render-api.md).

New cross-platform job APIs include:

- `POST /api/jobs`
- `GET /api/jobs`
- `POST /api/sources/probe`
- `GET /api/download/formats?url=<url>`
- `GET /api/browser/status`
- `POST /api/browser/start`
- `GET /api/translate/providers`

Legacy folder rendering APIs remain available for local task folders.

## License

MIT
