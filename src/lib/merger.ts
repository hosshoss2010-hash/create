// ============================================================
// خدمة دمج الفيديو — Video Merger API v2 (بلا مفاتيح أو توثيق)
// المخرجات: MP4 (H.264 + AAC) حتى 1080p — بلا معاملات resolution/fps.
// القواعد الحتمية (قسم 7):
//  - أي خطأ HTTP معلن من الخدمة (4xx/5xx بجسم error) = فشل نهائي فوري.
//  - أخطاء شبكتنا نحن (timeout/fetch) = مؤقتة → تابع الاستعلام حتى انتهاء النافذة.
//  - POST .../process يُطلق مرة واحدة فقط (قفل processInFlight في الذاكرة).
//  - 404 عند الاستعلام = فشل نهائي (الملف حُذف أو انتهت صلاحيته بعد 24 ساعة).
// ============================================================
import {
  ensureSchema,
  insertTask,
  getTask,
  updateTask,
  parseSqliteDate,
  type TaskRow,
} from "./turso";
import { clampWaitSeconds } from "./generation";

const MERGER_BASE = () =>
  (process.env.MERGER_API_BASE || "").trim().replace(/\/+$/, "");

export function mergerConfigured(): boolean {
  return MERGER_BASE().length > 0;
}

/** خطأ تحقق من معطيات الدمج (أقل من مقطعين، أكثر من 10، روابط غير عامة...) */
export class MergeValidationError extends Error {}

/** خطأ HTTP معلن من خدمة الدمج = فشل نهائي */
export class MergeServiceError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "MergeServiceError";
  }
}

// قفل في الذاكرة: يمنع تزامن POST .../process مع get_task (serverless: لكل نسخة قفلها)
const processInFlight = new Set<string>();

async function safeFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // خطأ شبكة لدينا — يُعامل مؤقتًا (لا فشل نهائي)
    throw new Error(`network: ${e instanceof Error ? e.message : "fetch failed"}`);
  }
}

/** فحص جهوزية خدمة الدمج عبر GET /api/config بمهلة 4 ثوانٍ */
export async function checkMergerHealth(): Promise<boolean> {
  const base = MERGER_BASE();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(4_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ===== تحليل حالة دفاعي (7.2) =====

const DONE_WORDS = ["done", "completed", "complete", "success", "succeeded", "finished"];
const FAIL_WORDS = ["error", "failed", "failure", "cancelled", "canceled"];

 
function parseMergeStatus(body: any): "done" | "failed" | "processing" {
  const status = String(body?.status ?? "").toLowerCase();
  if (DONE_WORDS.includes(status)) return "done";
  if (FAIL_WORDS.includes(status)) return "failed";
  // جسم فيه error بلا حقل status → failed فورًا
  if (body?.error) return "failed";
  return "processing";
}

 
function parseProgress(body: any): number {
  const p = Number(body?.progress ?? 0);
  if (!Number.isFinite(p) || p <= 0) return 0;
  // قد يرد كسرًا 0..1 → اضربه في 100
  if (p <= 1) return Math.round(p * 100);
  return Math.min(100, Math.round(p));
}

 
function resultUrlFromBody(body: any, jobId: string): string {
  // فضّل videoUrl ثم downloadUrl، وإلا اضبط رابط الملف مباشرة
  if (typeof body?.videoUrl === "string" && body.videoUrl) return body.videoUrl;
  if (typeof body?.downloadUrl === "string" && body.downloadUrl) return body.downloadUrl;
  return `${MERGER_BASE()}/api/jobs/${jobId}/video`;
}

/** هل الرابط http/https مباشر وعام (ليس localhost/شبكة داخلية)؟ */
export function isPublicHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const h = url.hostname.toLowerCase();
    if (!h) return false;
    if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local")) return false;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// ===== إنشاء/معالجة/استعلام وظائف الدمج =====

 
async function createMergeJob(urls: string[]): Promise<{ jobId: string; body: any }> {
  const res = await safeFetch(
    `${MERGER_BASE()}/api/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videos: urls }),
    },
    30_000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MergeServiceError(res.status, errOf(body, `HTTP ${res.status}`));
  const jobId = body?.jobId ?? body?.id ?? body?.data?.jobId;
  if (!jobId) throw new MergeServiceError(res.status, "استجابة إنشاء وظيفة الدمج بلا jobId");
  return { jobId: String(jobId), body };
}

 
function errOf(body: any, fallback: string): string {
  return (typeof body?.error === "string" && body.error) || body?.message || fallback;
}

/**
 * POST .../process — يستغرق ~10-15 ثانية (blocking)، يُنفَّذ مرة واحدة فقط بفضل القفل.
 * يعيد معلومات الاكتمال إن وُجدت؛ يرمي MergeServiceError عند خطأ معلن (نهائي).
 */
 
async function callProcess(jobId: string): Promise<any> {
  const res = await safeFetch(
    `${MERGER_BASE()}/api/jobs/${encodeURIComponent(jobId)}/process`,
    { method: "POST" },
    60_000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MergeServiceError(res.status, errOf(body, `HTTP ${res.status}`));
  return body;
}

 
async function getMergeStatus(jobId: string): Promise<any> {
  const res = await safeFetch(
    `${MERGER_BASE()}/api/jobs/${encodeURIComponent(jobId)}`,
    {},
    20_000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 404 = الوظيفة غير موجودة (حُذفت أو انتهت صلاحيتها) — رسالة المواصفة الحرفية
    if (res.status === 404) {
      throw new MergeServiceError(404, "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)");
    }
    throw new MergeServiceError(res.status, errOf(body, `HTTP ${res.status}`));
  }
  return body;
}

/** إطلاق process خلفيًا ومرة واحدة فقط */
function startProcessOnce(taskId: string, jobId: string): void {
  if (processInFlight.has(jobId)) return;
  processInFlight.add(jobId);
  void (async () => {
    try {
      // علّم أن process بدأ (يبقى صحيحًا عبر النسخ عبر params_json)
      const t = await getTask(taskId);
      const params = safeParams(t?.paramsJson);
      if (!params.processStarted) {
        params.processStarted = true;
        await updateTask(taskId, { paramsJson: JSON.stringify(params) });
      }
      await callProcess(jobId); // نجاحه تلتقطه حلقة الاستعلام
    } catch (e) {
      if (e instanceof MergeServiceError) {
        // خطأ معلن من الخدمة = فشل نهائي فوري (مثل Download failed (HTTP 403))
        await updateTask(taskId, { status: "failed", errorMessage: e.message.slice(0, 500) });
      }
      // أخطاء الشبكة: تتجاهل — الاستعلام الدوري سيكشف الحالة
    } finally {
      processInFlight.delete(jobId);
    }
  })();
}

function safeParams(json: string | undefined | null): { urls?: string[]; processStarted?: boolean } {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

/**
 * الحل والتحقق الصارم لمعطيات الدمج (7.3.1) — تُستخدم أيضًا من أداة MCP
 * قبل فحص إعدادات الخدمة حتى تظهر رسائل الرفض الصحيحة دائمًا.
 * الترتيب: روابط task_ids أولًا (حسب ترتيبها) ثم urls المباشرة.
 */
export async function resolveAndValidateMergeInputs(args: MergeArgs): Promise<string[]> {
  const failedIds: { id: string; reason: string }[] = [];
  const collected: string[] = [];
  for (const tid of args.taskIds ?? []) {
    const t = await getTask(tid.trim());
    const u = t && t.type === "video" && t.status === "completed" ? (t.resultUrls ?? [])[0] : undefined;
    if (u) collected.push(u);
    else
      failedIds.push({
        id: tid,
        reason: !t ? "غير موجودة" : t.type !== "video" ? "ليست مهمة فيديو" : t.status !== "completed" ? "غير مكتملة بعد" : "بلا رابط نتيجة",
      });
  }
  for (const u of args.urls ?? []) collected.push(u.trim());

  if (collected.length < 2) {
    let details = "";
    if (failedIds.length) {
      details =
        "\n\nتفاصيل المعرّفات غير الصالحة:\n" +
        failedIds.map((f) => `- ${f.id}: ${f.reason}`).join("\n");
    }
    throw new MergeValidationError(
      "❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة." + details
    );
  }
  if (collected.length > 10) {
    throw new MergeValidationError(
      "❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى)."
    );
  }
  const bad = collected.filter((u) => !isPublicHttpUrl(u));
  if (bad.length) {
    throw new MergeValidationError(
      "❌ كل الروابط يجب أن تكون http/https مباشرة وعامة. روابط غير صالحة:\n" +
        bad.map((b) => `- ${b}`).join("\n")
    );
  }
  return collected;
}

export interface MergeArgs {
  urls?: string[];
  taskIds?: string[];
  wait_seconds?: number;
}

export type MergeOutcome =
  | { kind: "completed"; task: TaskRow }
  | { kind: "processing"; task: TaskRow }
  | { kind: "failed"; task: TaskRow };

/**
 * تدفق runMerge وقواعده (7.3):
 *  1) تحقق صارم: ≥2 مقطعًا، ≤10، روابط http/https مباشرة وعامة — الترتيب:
 *     روابط task_ids أولًا (حسب ترتيبها) ثم urls المباشرة.
 *  2) سجّل المهمة في Turso أولًا.
 *  3) POST /api/jobs ثم أطلق process خلفيًا ومرة واحدة.
 *  4) استعلام كل 3 ثوانٍ مع بث تقدم وكتابة الحالة في Turso فورًا.
 */
export async function runMerge(
  args: MergeArgs,
  onProgress?: (percent: number, message: string) => void | Promise<void>,
  signal?: AbortSignal
): Promise<MergeOutcome> {
  await ensureSchema();

  // 1) الحل والتحقق الصارم (≥2، ≤10، روابط عامة) — الترتيب: task_ids ثم urls
  const collected = await resolveAndValidateMergeInputs(args);

  // 2) سجّل مهمة الدمج في Turso أولًا
  const task = await insertTask({
    type: "merge",
    model: "video-merger",
    prompt: `دمج ${collected.length} مقاطع`,
    paramsJson: JSON.stringify({ urls: collected, processStarted: false }),
    provider: "merger",
  });

  // 3) إنشاء الوظيفة لدى الخدمة
  let jobId: string;
  try {
    const job = await createMergeJob(collected);
    jobId = job.jobId;
    await updateTask(task.id, { providerTaskId: jobId });
  } catch (e) {
    if (e instanceof MergeServiceError) {
      // خطأ معلن من الخدمة عند الإنشاء = فشل نهائي
      await updateTask(task.id, { status: "failed", errorMessage: e.message.slice(0, 500) });
      return { kind: "failed", task: (await getTask(task.id))! };
    }
    // خطأ شبكة لدينا: تبقى processing وتُعاد المحاولة مع get_task (بتهدئة عبر refreshMergeTask)
    await updateTask(task.id, { errorMessage: "تعذر الوصول لخدمة الدمج — ستُعاد المحاولة تلقائيًا" });
    return { kind: "processing", task: (await getTask(task.id))! };
  }

  // أطلق process مرة واحدة خلفيًا (محمي بالقفل)
  startProcessOnce(task.id, jobId);

  // 4) حلقة الاستعلام حتى نهاية نافذة الانتظار
  const waitSeconds = clampWaitSeconds(args.wait_seconds, "merge");
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 3_000));
    if (signal?.aborted) break;

    const fresh = (await getTask(task.id))!;
    if (fresh.status === "completed" || fresh.status === "failed") return outcomeOf(fresh);

    let body: unknown;
    try {
      body = await getMergeStatus(jobId);
    } catch (e) {
      if (e instanceof MergeServiceError) {
        // 4xx/5xx معلن = فشل نهائي فوري — لا إعادة محاولة
        await updateTask(task.id, { status: "failed", errorMessage: e.message.slice(0, 500) });
        return { kind: "failed", task: (await getTask(task.id))! };
      }
      continue; // خطأ شبكتنا = مؤقت → تابع الاستعلام حتى انتهاء النافذة
    }
    const st = parseMergeStatus(body);
    if (st === "done") {
      await updateTask(task.id, {
        status: "completed",
        resultUrls: [resultUrlFromBody(body, jobId)],
        errorMessage: null,
      });
      await onProgress?.(100, "اكتمل الدمج");
      return { kind: "completed", task: (await getTask(task.id))! };
    }
    if (st === "failed") {
      await updateTask(task.id, { status: "failed", errorMessage: errOf(body, "فشل الدمج لدى الخدمة").slice(0, 500) });
      return { kind: "failed", task: (await getTask(task.id))! };
    }
    const pct = parseProgress(body);
    await updateTask(task.id, { progress: pct });
    await onProgress?.(pct, `قيد الدمج… ${pct}%`);
  }
  return { kind: "processing", task: (await getTask(task.id))! };
}

function outcomeOf(task: TaskRow): MergeOutcome {
  if (task.status === "completed") return { kind: "completed", task };
  if (task.status === "failed") return { kind: "failed", task };
  return { kind: "processing", task };
}

/** get_task لمهمة دمج: تحديث من GET /api/jobs/{id} مع كل قواعد 7.3.6 */
export async function refreshMergeTask(task: TaskRow): Promise<TaskRow> {
  if (task.status === "completed" || task.status === "failed") return task;

  const params = safeParams(task.paramsJson);

  // أ) لا jobId بعد: إعادة محاولة الإنشاء بعد تهدئة 45 ثانية
  if (!task.providerTaskId) {
    if (Date.now() - parseSqliteDate(task.updatedAt) < 45_000) return task;
    if (!params.urls || params.urls.length < 2) {
      await updateTask(task.id, { status: "failed", errorMessage: "معطيات الدمج غير مكتملة" });
      return (await getTask(task.id))!;
    }
    try {
      const job = await createMergeJob(params.urls);
      await updateTask(task.id, { providerTaskId: job.jobId, errorMessage: null });
      startProcessOnce(task.id, job.jobId);
    } catch (e) {
      if (e instanceof MergeServiceError) {
        await updateTask(task.id, { status: "failed", errorMessage: e.message.slice(0, 500) });
      }
      // شبكة: ابقَ processing
    }
    return (await getTask(task.id))!;
  }

  const jobId = task.providerTaskId;

  let body: unknown;
  try {
    body = await getMergeStatus(jobId);
  } catch (e) {
    if (e instanceof MergeServiceError) {
      // يشمل 404: «مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)»
      await updateTask(task.id, { status: "failed", errorMessage: e.message.slice(0, 500) });
    }
    return (await getTask(task.id))!;
  }

  const st = parseMergeStatus(body);
  if (st === "done") {
    await updateTask(task.id, {
      status: "completed",
      resultUrls: [resultUrlFromBody(body, jobId)],
      errorMessage: null,
    });
    return (await getTask(task.id))!;
  }
  if (st === "failed") {
    await updateTask(task.id, { status: "failed", errorMessage: errOf(body, "فشل الدمج لدى الخدمة").slice(0, 500) });
    return (await getTask(task.id))!;
  }
  // processing: إن لم يُنفَّذ process بعد فنفّذه الآن (القفل يمنع التزامن)
  if (!params.processStarted && !processInFlight.has(jobId)) {
    startProcessOnce(task.id, jobId);
  }
  const pct = parseProgress(body);
  if (pct > task.progress) await updateTask(task.id, { progress: pct });
  return (await getTask(task.id))!;
}
