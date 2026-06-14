import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
// Import z from the `zod/v3` subpath so the schema types align with the ones
// @modelcontextprotocol/sdk uses internally (its AnySchema = zod/v3 ZodTypeAny |
// zod/v4 $ZodType). On zod 3.25.x the main `zod` entry's internal type structure
// differs from `zod/v3`, which breaks MCP's registerTool type inference.
import { z } from "zod/v3";

import type { CreateJobRequest, JobOptions, RevideoJob, TargetPlatform } from "../jobs/types";
import { loadJob, listJobs } from "../jobs/store";
import { getJobEvents } from "../jobs/events";
import { listPlatformCapabilities } from "../platforms/registry";

/**
 * Internal orchestration functions from server.ts, injected to avoid importing
 * server.ts directly (which calls app.listen at module top-level and would start
 * a second HTTP server). Passing these as deps lets the MCP tools reuse all the
 * existing job pipeline logic with zero changes to their visibility.
 */
export interface RevideoMcpDeps {
  createJobFromRequest: (
    body: CreateJobRequest,
    force?: boolean,
  ) => Promise<{ job: RevideoJob; probe: unknown }>;
  enqueueJobRun: (
    jobId: string,
    options?: { steps?: string[]; force?: boolean; formatId?: string },
  ) => unknown;
  defaultRunSteps: (publishAction?: string) => string[];
  snapshotQueue: () => unknown;
  cancelJobRunsForJob: (jobId: string, reason: string) => void;
}

// ------------------------------------------------------------------
// Result helpers
// ------------------------------------------------------------------

function text(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function json(label: string, value: unknown): CallToolResult {
  return text(`${label}:\n${JSON.stringify(value, null, 2)}`);
}

function error(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** A token-friendly summary of a job — not a full dump. */
function summarizeJob(job: RevideoJob) {
  const step = job.workflow.currentStep;
  const stepState = job.workflow.steps[step];
  return {
    jobId: job.id,
    title: job.source.metadata?.title,
    sourcePlatform: job.source.platform,
    url: job.source.url,
    currentStep: step,
    stepStatus: stepState?.status,
    percent: stepState?.percent,
    error: stepState?.error,
    targets: job.targets.map((t) => ({
      platform: t.platform,
      status: t.status,
      error: t.error,
      result: t.result,
    })),
    outputVideo: job.artifacts.outputVideo,
    coverImage: job.artifacts.coverImage,
    requirement: job.requirement,
    updatedAt: job.updatedAt,
  };
}

const JOB_SUMMARY_HINT =
  "Poll this with get_job. Rendering/publishing take minutes; the tool returns immediately with a queued jobId.";

// ------------------------------------------------------------------
// Tool registration
// ------------------------------------------------------------------

/**
 * Creates an MCP server exposing high-level Revideo tools and mounts a stateless
 * Streamable HTTP transport at POST /mcp.
 *
 * To add auth later: wrap the POST handler (or add Express middleware before it)
 * and reject requests lacking a valid Authorization header read from settings/env.
 */
export function mountMcp(app: Express, deps: RevideoMcpDeps): void {
  const server = new McpServer({ name: "revideo-server", version: "1.0.0" });

  // submit_video_job — one-shot: submit a source URL and auto-run the full pipeline
  server.registerTool(
    "submit_video_job",
    {
      description:
        "Submit a source video URL and automatically run the full pipeline " +
        "(download → translate → generate cover → render → generate platform drafts → " +
        "optionally publish) to the configured target platforms. Returns immediately with " +
        "a jobId (async). " + JOB_SUMMARY_HINT,
      inputSchema: {
        url: z
          .string()
          .describe("Source video URL (e.g. YouTube / TikTok / Bilibili link)"),
        targets: z
          .array(z.string())
          .optional()
          .describe(
            "Target publish platforms, e.g. [\"bilibili\", \"douyin\"]. " +
              "Omit to use the server's configured default platforms.",
          ),
        requirement: z
          .string()
          .optional()
          .describe("Natural-language requirement / instructions for this job"),
        options: z
          .object({
            targetLanguage: z.string().optional(),
            publishAction: z
              .enum(["draft", "publish"])
              .optional()
              .describe('"draft" to generate platform drafts without publishing; "publish" to publish'),
            repeatTimes: z.number().int().min(1).max(10).optional(),
            subtitleMode: z.enum(["auto", "always", "off"]).optional(),
            commentMode: z.enum(["auto", "always", "off"]).optional(),
            outputAspect: z.enum(["auto", "portrait", "landscape", "source"]).optional(),
            renderComments: z.boolean().optional(),
          })
          .optional()
          .describe("Optional job options; omitted values fall back to server settings"),
        force: z
          .boolean()
          .optional()
          .describe("Recreate the job if a job for this source already exists"),
      },
    },
    async (args) => {
      try {
        const body: CreateJobRequest = {
          source: { url: args.url },
          ...(args.targets?.length
            ? { targets: args.targets.map((p) => ({ platform: p as TargetPlatform })) }
            : {}),
          ...(args.options ? { options: args.options as JobOptions } : {}),
          ...(args.requirement ? { requirement: args.requirement } : {}),
        };
        const { job } = await deps.createJobFromRequest(body, Boolean(args.force));
        deps.enqueueJobRun(job.id, { steps: deps.defaultRunSteps(job.options.publishAction) });
        return json("Job submitted", {
          jobId: job.id,
          job: summarizeJob(job),
          queue: deps.snapshotQueue(),
        });
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // get_job — focused status query
  server.registerTool(
    "get_job",
    {
      description:
        "Get the current status, progress, per-target state, and output paths for a job. " +
        "Use this to poll a job submitted via submit_video_job.",
      inputSchema: {
        jobId: z.string().describe("Job id returned by submit_video_job"),
      },
    },
    async (args) => {
      const job = loadJob(args.jobId);
      if (!job) return error(`Job not found: ${args.jobId}`);
      return json(`Job ${args.jobId}`, summarizeJob(job));
    },
  );

  // list_jobs — compact list
  server.registerTool(
    "list_jobs",
    {
      description: "List recent jobs (most recently updated first), with a compact summary each.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Max jobs to return (default 50)"),
      },
    },
    async (args) => {
      const limit = args.limit ?? 50;
      const jobs = listJobs().slice(0, limit).map((job) => {
        const step = job.workflow.currentStep;
        return {
          jobId: job.id,
          title: job.source.metadata?.title,
          sourcePlatform: job.source.platform,
          currentStep: step,
          stepStatus: job.workflow.steps[step]?.status,
          updatedAt: job.updatedAt,
        };
      });
      return json(`Jobs (${jobs.length})`, jobs);
    },
  );

  // get_job_events — diagnostic log
  server.registerTool(
    "get_job_events",
    {
      description:
        "Get the append-only event log for a job (useful for diagnosing failures). " +
        "Returns the most recent events, oldest-first.",
      inputSchema: {
        jobId: z.string(),
        tail: z.number().int().min(1).max(500).optional().describe("Number of most recent events (default 50)"),
      },
    },
    async (args) => {
      const events = getJobEvents(args.jobId);
      if (!events.length) return error(`No events found for job: ${args.jobId}`);
      const tail = args.tail ?? 50;
      return json(`Events for ${args.jobId} (${Math.min(tail, events.length)})`, events.slice(-tail));
    },
  );

  // list_platforms — capabilities
  server.registerTool(
    "list_platforms",
    {
      description:
        "List supported source platforms and publish (target) platforms, " +
        "including which adapters are implemented. Call this to see what's available before submitting.",
      inputSchema: {},
    },
    async () => json("Platform capabilities", listPlatformCapabilities()),
  );

  // cancel_job
  server.registerTool(
    "cancel_job",
    {
      description:
        "Cancel any queued or running work for a job (download/translate/render/publish). " +
        "Safe to call on an already-finished job.",
      inputSchema: {
        jobId: z.string(),
      },
    },
    async (args) => {
      if (!loadJob(args.jobId)) return error(`Job not found: ${args.jobId}`);
      deps.cancelJobRunsForJob(args.jobId, "Cancelled via MCP");
      return json(`Cancelled ${args.jobId}`, summarizeJob(loadJob(args.jobId)!));
    },
  );

  // ----------------------------------------------------------------
  // Stateless Streamable HTTP transport at /mcp
  // ----------------------------------------------------------------

  // MCP requests (initialize, tools/list, tools/call) all arrive as POST.
  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      // Close the per-request transport when the client disconnects (stateless).
      res.on("close", () => transport.close());
      // req.body is already parsed by the global express.json() middleware.
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  // Stateless server: no SSE upgrade stream and no sessions to delete.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed: this is a stateless MCP endpoint, use POST." });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed: stateless MCP endpoint has no sessions to delete." });
  });
}
