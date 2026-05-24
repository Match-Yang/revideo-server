# Revideo Server

Video rendering, workflow, and publishing service built on Remotion.

The project is being migrated from a YouTube-to-Bilibili helper into a platform-neutral reposting pipeline:

```text
source platform -> canonical job assets -> processing workflow -> target platforms
```

See [docs/cross-platform-pipeline.md](docs/cross-platform-pipeline.md) for the target architecture.

## Commands

**Install Dependencies**

```console
npm i
```

**Start Preview**

```console
npm run dev
```

**Start API and management panel**

```console
npm run ui
```

Open `http://localhost:3001`.

**Configure translation**

Copy `.env.example` to `.env`, then fill the provider settings. For Volcengine Ark:

```env
TRANSLATE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
TRANSLATE_MODEL=doubao-your-model-id
TRANSLATE_API_KEY_ENV=VOLCENGINE_API_KEY
VOLCENGINE_API_KEY=your-volcengine-ark-api-key
TRANSLATE_THINKING_TYPE=disabled
```

`TRANSLATE_MODEL` can be either a Volcengine Ark Model ID or an inference endpoint ID. `TRANSLATE_THINKING_TYPE=disabled` turns off Ark's thinking mode for translation calls. `ARK_API_KEY` is also supported if you prefer the variable name used in many Ark examples. Restart `npm run ui` after editing `.env`.

Translation safety is handled as model review plus Chinese post-scan. Source text is not locally pre-scanned because comments and subtitles may be in any language, including normal Chinese comments.

**Render video**

```console
npx remotion render
```

**Upgrade Remotion**

```console
npx remotion upgrade
```

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

The old APIs remain available during migration.
