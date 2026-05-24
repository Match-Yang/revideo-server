# Implementation Task List

This is the working checklist for moving `revideo-server` to the final cross-platform pipeline.

## Current Baseline

Completed:

- Canonical Job model under `data/jobs/<jobId>/manifest.json`.
- Job event log under `data/events.jsonl`.
- Source adapter registry with YouTube implemented and TikTok/Bilibili/Douyin placeholders.
- YouTube URL and Shorts URL probing.
- YouTube source download through the service.
- Canonical asset normalization.
- Job render endpoint using canonical assets.
- Lightweight job runner for `download -> normalize -> render`.
- Browser status/start/stop/restart API with CDP startup.
- OpenAI-compatible translation provider test endpoint.
- Basic management panel for system state, new Jobs, and legacy tasks.

## P0: Publish Flow Into Job Runner

- [x] Define canonical `PublishDraft` and `PublishResult` types.
- [x] Move current Bilibili publishing implementation behind a publisher adapter.
- [x] Move current Douyin publishing implementation behind a publisher adapter, but keep it disabled by default while the account is unavailable.
- [x] Add target-platform status per job target:
  - `pending`
  - `preflighting`
  - `publishing`
  - `published`
  - `failed`
  - `skipped`
- [x] Add `POST /api/jobs/:jobId/drafts/generate`.
- [x] Add `POST /api/jobs/:jobId/publish`.
- [x] Extend `POST /api/jobs/:jobId/run` to support:
  - `generate-drafts`
  - `preflight-publish`
  - `publish`
- [x] Before publishing, check existing target status and refuse accidental duplicate publishes unless `force: true`.
- [x] Persist publish result JSON under `data/jobs/<jobId>/publish/<platform>-result.json`.
- [x] Preserve legacy `POST /api/publish` while routing new jobs through publisher adapters.
- [ ] Add stronger platform-specific draft validation before publish.
- [ ] Add SSE progress for job publish. Background queue now records publish as Job events, but does not stream per-publisher browser progress yet.

## P0: Browser Management

- [x] Add browser executable discovery for:
  - Puppeteer-managed Chrome
  - system Chrome
  - Chrome Canary
  - Chromium
- [ ] Add install/repair API for Puppeteer Chrome:
  - `POST /api/browser/install`
  - `POST /api/browser/repair`
- [ ] Add profile management:
  - current profile path
  - reset profile
  - open profile directory
- [x] Add login-state preflight checks:
  - Bilibili creator center reachable
  - Bilibili login detected
  - Douyin creator center reachable
  - Douyin login detected
- [x] Add `POST /api/browser/open-login/:platform`.
- [ ] Add browser health to `/api/health`.
- [x] In publisher adapters, never assume Chrome is already running; call browser manager first.
- [ ] Record browser/preflight failures as Job events.

## P0: Data Directory and Runtime Hygiene

- Keep all workflow-owned files under `data/jobs/<jobId>`.
- Stop writing new workflow source files into `~/Movies`.
- Keep `public/` as render scratch only.
- Decide whether rendered output should stay in `out/` or move to `data/jobs/<jobId>/derived/render/`.
- Add retention/cleanup policy for:
  - temporary render scratch
  - downloaded source media
  - generated outputs
  - browser profiles
- Add job export bundle endpoint for debugging.
- [x] Add safe artifact read endpoint for Job-owned files.

## P1: Translation Pipeline

- [x] Define canonical translation batch format for subtitles and comments.
- [x] Implement OpenAI-compatible batch translation for comments.
- [x] Implement OpenAI-compatible subtitle translation while preserving timing.
- [x] Add recursive split retry for model refusals and malformed batch responses.
- [x] Add sensitive-content filtering hooks and post-translation scan.
- [ ] Add Chinese ratio validation for translated comments.
- [x] Persist translation artifacts:
  - `source/comments/translated.zh-CN.json`
  - `source/subtitles/translated.zh-CN.vtt`
- [x] Persist moderation reports.
- [x] Add `POST /api/jobs/:jobId/translate`.
- [x] Extend runner with `translating-assets`.

## P1: Copy Generation

- Define platform-specific draft schemas:
  - Bilibili: title, description, tags, category
  - Douyin: title, description, hashtags
  - YouTube: title, description, tags, category
  - TikTok: caption, hashtags
  - Xiaohongshu: title, body, topics
- Implement Bilibili draft generation first.
- Include source attribution rules in draft generation.
- Persist drafts under `data/jobs/<jobId>/derived/copy/<platform>.json`.
- Allow human editing of drafts in the management panel before publishing.

## P1: Workflow Runner and Queue

- [x] Add background queued job runner while preserving synchronous `/run`.
- [x] Add queue state:
  - idle
  - running
  - failed
  - cancelled
- [x] Add `GET /api/jobs/queue`.
- [x] Add `POST /api/jobs/:jobId/start`.
- [x] Add `POST /api/jobs/:jobId/retry`.
- [x] Add `POST /api/jobs/:jobId/cancel` for queued runs and render cancellation.
- Add `POST /api/jobs/:jobId/resume-from/:step`.
- Add server startup recovery:
  - rendering jobs without output become failed
  - completed artifacts are detected and steps are marked completed
  - publish status is not retried blindly
- Add SSE job event stream:
  - `GET /api/jobs/:jobId/stream`

## P1: Management Panel

- Split panel into tabs:
  - Jobs
  - Job detail
  - Browser
  - Health
  - Settings
  - Legacy tasks
- [x] Add lightweight Job detail panel with workflow steps and recent events.
- [x] Add queue status to the management panel.
- [x] Add moderation report summary in Job detail.
- Add full job detail timeline from events.
- Add artifact preview:
  - source video
  - rendered video
  - cover
  - comments
  - subtitles
- Add browser control buttons:
  - start
  - stop
  - restart
  - open login page
- Add draft editor before publish.
- Add retry/cancel/resume buttons.

## P2: More Source Platforms

- TikTok source adapter:
  - probe
  - download
  - metadata normalization
  - comments if available
- Bilibili source adapter.
- Douyin source adapter.
- Xiaohongshu source adapter.
- Instagram/Reels source adapter.
- X video source adapter.

## P2: More Publisher Platforms

- YouTube/Shorts publisher adapter.
- TikTok publisher adapter.
- Xiaohongshu publisher adapter.
- Instagram/Reels publisher adapter.
- X publisher adapter.

## P2: Tests and Reliability

- Add unit tests for:
  - URL adapter matching
  - YouTube ID extraction
  - format recommendation
  - manifest persistence
  - normalization
- Add integration tests for:
  - probe
  - download small video
  - normalize
  - render short video
- Add mocked publisher adapter tests.
- Add lint cleanup for existing files so full `npm run lint` is useful again.
- Add CI-friendly health check command.
