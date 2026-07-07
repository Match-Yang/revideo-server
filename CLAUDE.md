# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Revideo Server is a video rendering, translation, and cross-platform republishing service. It follows a pipeline: `source platform → canonical job assets → processing workflow → target platforms`. The server is written in TypeScript (Express v5) with a Next.js 16 dashboard. All data is file-based — no database.

## Commands

```bash
# Development (runs API on :6688 + dashboard dev server concurrently, with hot reload).
# dev.sh first unloads any revideo launchd services and frees ports 6688/3000.
bash scripts/dev.sh

# Type-check and lint
npm run lint

# Dashboard
npm run dashboard:install   # install deps
npm run dashboard:build     # static export to dashboard/out/

# Smoke tests
npm run test:moderation
npm run test:translation-batch
```

There is no general test suite. The project uses `tsx` to run TypeScript directly — no build step for the server.

## Architecture

### Dual-package monorepo

- **Root (`src/`):** Express v5 API server, runs via `tsx src/server.ts` on port 6688 (configurable via `REVIDEO_PORT`).
- **`dashboard/`:** Next.js 16 app with shadcn/ui, static-exported to `dashboard/out/` and served by Express. Uses Biome (not ESLint) for linting. Has its own `package.json`.

### Job Pipeline

Jobs (`src/jobs/types.ts`) progress through steps:

```
created → probing-source → downloading-source → normalizing-assets
→ translating-assets → generating-cover-image → rendering-video
→ generating-platform-drafts → preflighting-targets → publishing-targets
→ completed
```

Key modules in `src/jobs/`:
- **`store.ts`** — Filesystem CRUD for jobs (`data/jobs/<id>/manifest.json`)
- **`normalize.ts`** — Walks downloaded files into canonical asset paths
- **`translate-job.ts`** — LLM-based translation with safety moderation
- **`generate-cover.ts`** — Vision LLM selects frames, sharp composes covers
- **`render-job.ts`** — Adapts FFmpeg rendering for the job pipeline
- **`drafts.ts`** — LLM generates platform-specific publish metadata
- **`publish-job.ts`** — Delegates to publisher adapters
- **`events.ts`** — Append-only JSONL event log per job

### Platform Adapters (`src/platforms/`)

- **Source adapters** (`sources/`): YouTube implemented (yt-dlp); TikTok/Bilibili/Douyin planned
- **Publisher adapters** (`publishers/`): Bilibili implemented (Puppeteer browser automation); Douyin stub; others planned

### Key Constraints

- **Single concurrent render** — enforced by `currentRender` in `server.ts`
- **In-memory job queue** — lost on restart; `server.ts` has recovery logic for interrupted jobs
- **File-based storage** — all data in `data/` (JSON manifests, JSONL events, settings)
- **External binaries required:** `yt-dlp`, `ffmpeg`, `ffprobe` (paths configurable via env vars)
- **Browser automation for publishing** — Puppeteer with persistent Chrome profile at `data/browser/profile/`, CDP on port 9222

### Translation

Uses an OpenAI-compatible chat completions API (`src/translate/openai-compatible.ts`), configured from the Dashboard settings page and persisted in `data/settings.json`.

### Legacy Coexistence

Legacy folder-based rendering (`src/renderer.ts`) and task management (`src/task-manager.ts`) coexist with the newer jobs pipeline. Legacy tasks are stored in `data/tasks.json`.

## Dashboard (`dashboard/`)

- Next.js 16 App Router with route groups: `(main)` for authenticated pages, `(external)` for landing
- shadcn/ui components in `src/components/ui/`
- Tailwind CSS v4, Zustand for state, i18n with dictionary provider
- Lint/format with Biome (`npx @biomejs/biome check`), not ESLint

## Configuration

- `src/config.ts` — Resolves server port and data paths from process environment variables
- `src/settings.ts` — Deep-mergeable `RevideoSettings` persisted to `data/settings.json`

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
