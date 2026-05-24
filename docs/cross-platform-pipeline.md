# Cross-Platform Revideo Pipeline

## Goal

`revideo-server` is moving from a YouTube-to-Bilibili helper into a platform-neutral reposting pipeline:

```text
source platform -> canonical job assets -> processing workflow -> target platforms
```

The first implemented path remains YouTube/Shorts as a source and Bilibili/Douyin as publishers, but the core model must not assume either side.

## Responsibilities

### revideo-server

- Owns job state, events, queueing, retries, and recovery.
- Probes source URLs and downloads source assets.
- Normalizes metadata, subtitles, comments, and media files into a canonical job directory.
- Runs translation through an OpenAI-compatible provider.
- Runs rendering through Remotion.
- Manages browser/CDP startup, profile directories, and platform preflight checks.
- Publishes to target platforms through publisher adapters.
- Provides a management panel for humans and APIs for agents.

### OpenClaw / Agent

- Submits user intent through APIs.
- Optionally asks for source formats and chooses resolution or options.
- Reads job status and events through APIs.
- Retries or reports failures through APIs.
- Does not own browser startup, download commands, render commands, or platform-specific publishing details.

## Data Layout

All workflow-owned data should live under `data/`:

```text
data/
  events.jsonl
  jobs/
    index.json
    <jobId>/
      manifest.json
      source/
        media/
        metadata/
        subtitles/
        comments/
      derived/
        render/
        copy/
      publish/
  browser/
    profile/
```

Legacy folders such as `~/Movies`, `public/`, and `out/` remain supported while the migration is in progress.

## Job Model

Jobs are platform-neutral:

```json
{
  "source": {
    "platform": "youtube",
    "url": "https://www.youtube.com/watch?v=...",
    "contentId": "...",
    "metadata": {}
  },
  "targets": [
    { "platform": "bilibili", "status": "pending" }
  ],
  "options": {
    "targetLanguage": "zh-CN",
    "renderTemplate": "comments-reaction",
    "downloadQuality": "auto"
  },
  "workflow": {
    "currentStep": "probing-source",
    "steps": {}
  }
}
```

Workflow steps:

```text
created
probing-source
downloading-source
normalizing-assets
translating-assets
moderating-assets
rendering-video
generating-platform-drafts
preflighting-targets
publishing-targets
completed
failed
cancelled
```

## Adapter Boundaries

Source adapters implement:

```ts
matchUrl(url)
probe(url)
download(request)
```

Publisher adapters implement:

```ts
preflight()
validateDraft(draft)
publish(request)
```

Planned source adapters include YouTube, TikTok, Bilibili, Douyin, Xiaohongshu, Instagram, and X. Planned publisher adapters include Bilibili, Douyin, YouTube, TikTok, Xiaohongshu, Instagram, and X.

## New APIs

Platform discovery:

```http
GET /api/platforms
```

Source probing:

```http
POST /api/sources/probe
GET /api/download/formats?url=<url>
```

Job management:

```http
POST /api/jobs
GET /api/jobs
GET /api/jobs/:jobId
GET /api/jobs/:jobId/events
POST /api/jobs/:jobId/download
POST /api/jobs/:jobId/normalize
POST /api/jobs/:jobId/translate
POST /api/jobs/:jobId/render
POST /api/jobs/:jobId/drafts/generate
POST /api/jobs/:jobId/preflight-publish
POST /api/jobs/:jobId/publish
POST /api/jobs/:jobId/run
```

Compatibility shortcut:

```http
POST /api/workflows/youtube
```

Browser management:

```http
GET /api/browser/status
GET /api/browser/health
GET /api/browser/login/:platform
POST /api/browser/start
POST /api/browser/stop
POST /api/browser/restart
POST /api/browser/open-login/:platform
```

Translation:

```http
GET /api/translate/providers
POST /api/translate/test
```

## Migration Plan

1. Keep existing `/api/tasks`, `/api/render-folder`, and `/api/publish` stable.
2. Build `/api/jobs` and canonical data layout in parallel.
3. Move source probing and downloading into source adapters.
4. Move translation into OpenAI-compatible batch processors.
5. Move rendering and publishing under the job workflow runner.
6. Replace OpenClaw's long manual workflow with short API instructions.
