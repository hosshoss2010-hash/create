// ============================================================
// خادم MCP — أدوات التوليد الخمس (المسار /mcp)
// - يستخدم SDK الرسمي: McpServer + WebStandardStreamableHTTPTransport
//   (نقل Streamable HTTP الرسمي بواجهة Web Request/Response المناسبة لـ
//    Next.js App Router وVercel — لا JSON-RPC يدويًا إطلاقًا).
// - الأوصاف إنجليزية (يقرأها نموذج العميل) ونتائج الاستدعاء بالعربية.
// - progress notifications حية كل ~3 ثوانٍ عند تزويد العميل بـ _meta.progressToken.
// ============================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runGeneration,
  refreshTask,
  ParamsValidationError,
  type OnProgress,
} from "@/lib/generation";
import { runMerge, mergerConfigured, MergeValidationError, resolveAndValidateMergeInputs } from "@/lib/merger";
import { listRecentTasks } from "@/lib/turso";
import {
  textForGenOutcome,
  textForMergeOutcome,
  textForTask,
  formatList,
} from "@/lib/replies";

export const SERVER_INFO = { name: "media-generator-mcp", version: "1.2.0" } as const;

export const SERVER_INSTRUCTIONS = `AI media generation server (kie.ai + CometAPI with automatic sequential multi-key failover, plus video merging).
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Never stop or warn the user about keys or balances; just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
Use list_media to recall previously generated media from the database.`;

/** مُرسل التقدم الحي عبر notifications/progress (إذا زوّد العميل progressToken) */
function progressSender(extra: { _meta?: { progressToken?: unknown }; sendNotification: (n: unknown) => Promise<void> }): OnProgress {
  const token = extra._meta?.progressToken;
  return async (percent, message) => {
    if (token === undefined) return;
    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: Math.round(percent), total: 100, message },
      });
    } catch {
      // انقطاع العميل أثناء البث — تجاهل بهدوء
    }
  };
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const err = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** تغليف صياغة الردود العربية في شكل ToolResult الصحيح */
const wrap = (r: { text: string; isError: boolean }): ToolResult =>
  r.isError ? err(r.text) : ok(r.text);

/** غلاف آمن: أي استثناء غير متوقع يعود خطأً عربيًا بدون تفاصيل داخلية */
function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch((e) => {
    if (e instanceof ParamsValidationError || e instanceof MergeValidationError) return err(e.message);
    return err("❌ حدث خطأ غير متوقع داخل الخادم. أعد المحاولة، وإذا تكرر فتابع المهمة بـ get_task أو راجع واجهة الإدارة.");
  });
}

export function buildMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  // ---------- 1) generate_image ----------
  server.registerTool(
    "generate_image",
    {
      description:
        "Generate an image with gpt-image-2-6/flare-text-to-image (automatic failover across all active API keys in strict order). Returns the finished image URL directly if it completes within the wait window; otherwise returns a task_id — call get_task with it every ~10 seconds until status is completed, then show the URL and stop.",
      inputSchema: {
        prompt: z.string().min(1).describe("What to draw. Detailed prompts give better results."),
        model: z
          .enum(["gpt-image-2-6/flare-text-to-image", "gpt-image-2.6/flare-text-to-image"])
          .default("gpt-image-2-6/flare-text-to-image"),
        aspect_ratio: z
          .enum(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"])
          .default("auto"),
        resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
        background: z.enum(["auto", "transparent", "opaque"]).default("auto").describe("Only applied at 1K."),
        output_format: z.enum(["png", "jpeg", "webp", "gif"]).default("png"),
        wait_seconds: z.number().int().min(0).max(240).default(90),
      },
    },
    async (args, extra) =>
      safe(async () => {
        const outcome = await runGeneration("image", args, progressSender(extra), extra.signal);
        return wrap(textForGenOutcome(outcome));
      })
  );

  // ---------- 2) generate_video ----------
  server.registerTool(
    "generate_video",
    {
      description:
        "Generate a video with grok-imagine-video-1-5-preview (native synchronized audio — dialogue in the prompt is spoken in the video; optional image-to-video via image_url). Videos take minutes: a short wait streams live progress, then a task_id is returned — track it with get_task every ~10 seconds until completed, then show the URL and stop.",
      inputSchema: {
        prompt: z.string().min(1).max(4096).describe("Scene description. Dialogue in the prompt is spoken in the video."),
        image_url: z.string().optional().describe("Optional public image URL as the first frame (image-to-video)."),
        model: z
          .enum(["grok-imagine-video-1-5-preview", "grok-imagine-video-1.5-preview"])
          .default("grok-imagine-video-1-5-preview"),
        aspect_ratio: z.enum(["auto", "1:1", "16:9", "9:16", "3:2", "2:3"]).default("auto"),
        resolution: z.enum(["480p", "720p", "1080p"]).default("480p"),
        enable_audio: z.boolean().default(true),
        duration: z.number().int().min(1).max(15).default(8).describe("Duration in seconds."),
        wait_seconds: z.number().int().min(0).max(240).default(25),
      },
    },
    async (args, extra) =>
      safe(async () => {
        const outcome = await runGeneration("video", args, progressSender(extra), extra.signal);
        return wrap(textForGenOutcome(outcome));
      })
  );

  // ---------- 3) merge_videos ----------
  server.registerTool(
    "merge_videos",
    {
      description:
        "Merge several clips into ONE final video in the given order. Pass 'urls' (public direct video links, e.g. from generate_video) or 'task_ids' (COMPLETED video generation tasks — their result URLs are resolved from the database in this order, ideal after generating several clips). Merging is usually fast: a short wait streams progress, then a merge task_id is returned — track it with get_task. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.",
      inputSchema: {
        urls: z
          .array(z.string())
          .min(2)
          .max(10)
          .optional()
          .describe("Public direct video URLs (http/https) in merge order — the first clip starts the final video."),
        task_ids: z
          .array(z.string())
          .min(2)
          .max(10)
          .optional()
          .describe("Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order."),
        wait_seconds: z.number().int().min(0).max(240).default(60),
      },
    },
    async (args, extra) =>
      safe(async () => {
        // التحقق من المعطيات أولًا (رسائل الرفض الصحيحة حتى لو كانت الخدمة غير مهيأة)
        await resolveAndValidateMergeInputs({ urls: args.urls, taskIds: args.task_ids });
        // الدمج لا يحتاج مفاتيح، لكن يحتاج عنوان خدمة الدمج
        if (!mergerConfigured()) {
          return err("❌ خدمة الدمج غير مهيأة على الخادم — اضبط MERGER_API_BASE في متغيرات البيئة ثم أعد المحاولة.");
        }
        const outcome = await runMerge(
          { urls: args.urls, taskIds: args.task_ids, wait_seconds: args.wait_seconds },
          progressSender(extra),
          extra.signal
        );
        return wrap(textForMergeOutcome(outcome));
      })
  );

  // ---------- 4) get_task ----------
  server.registerTool(
    "get_task",
    {
      description:
        "Track any task by its id — image/video generation AND merging. Reads the database and live-updates from the provider/merging service while the task is still processing. Poll it every ~10 seconds; when status is completed you'll find the result URLs — show them to the user and stop polling.",
      inputSchema: {
        task_id: z.string(),
      },
    },
    async (args) =>
      safe(async () => {
        const task = await refreshTask(args.task_id);
        if (!task) return err(`❌ لم يتم العثور على مهمة بالمعرّف: ${args.task_id}`);
        return wrap(textForTask(task));
      })
  );

  // ---------- 5) list_media ----------
  server.registerTool(
    "list_media",
    {
      description:
        "List the most recent images/videos/merges stored in the database with their result URLs (no regeneration) — use it to recall previously generated media.",
      inputSchema: {
        type: z.enum(["image", "video", "merge"]).optional(),
        status: z.enum(["completed", "failed", "processing"]).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async (args) =>
      safe(async () => {
        const tasks = await listRecentTasks(args.limit ?? 10, { type: args.type, status: args.status });
        return ok(formatList(tasks));
      })
  );

  return server;
}
