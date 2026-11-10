// ============================================================
// منسّق التوليد — runGeneration / refreshTask
// سلوك التبديل «لا توقف أبدًا» (قسم 4.3):
//  1) تجربة المرشحين بالترتيب التسلسلي حتى نجاح الإنشاء.
//  2) فشل منتصف المهمة بسبب مفتاح/رصيد → إعادة إنشاء نفس المهمة بنفس task_id
//     على المفتاح التالي تلقائيًا — العميل يرى «قيد المعالجة» فقط.
//  3) فشل على كل المفاتيح → تبقى processing «بانتظار توفر مفتاح صالح…»
//     وتُعاد المحاولة مع كل get_task بعد تهدئة ~45 ثانية.
//  4) أخطاء المفاتيح/الرصيد لا تخرج أبدًا للعميل (انظر replies.sanitizeError).
// ============================================================
import {
  ensureSchema,
  insertTask,
  getTask,
  updateTask,
  getKeyById,
  parseSqliteDate,
  type TaskRow,
  type TaskType,
  type AttemptRecord,
} from "./turso";
import {
  getKeyPool,
  classifyProviderError,
  markKeyStatus,
  bumpKeyCounters,
  KEY_OR_BALANCE_PATTERN,
} from "./keys";
import { findModel, type ModelDef } from "./models";
import { getAdapter, ProviderError, type CheckResult } from "./providers";
import { refreshMergeTask } from "./merger";

export const WAITING_MSG = "بانتظار توفر مفتاح صالح…";

/** خطأ معطيات من المستخدم (موديل غير معروف مثلًا) — يُعرض كما هو لأنه ليس خطأ مفاتيح */
export class ParamsValidationError extends Error {}

export type OnProgress = (percent: number, message: string) => void | Promise<void>;

export interface GenArgs {
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  background?: string;
  output_format?: string;
  image_url?: string;
  enable_audio?: boolean;
  duration?: number;
  wait_seconds?: number;
}

export type GenOutcome =
  | { kind: "completed"; task: TaskRow }
  | { kind: "processing"; task: TaskRow }
  | { kind: "failed"; task: TaskRow }
  | { kind: "no_keys"; model: string };

const POLL_INTERVAL_MS = 3_000; // استعلام كل 3 ثوانٍ أثناء نافذة الانتظار
const CREATE_COOLDOWN_MS = 45_000; // تهدئة إعادة الإنشاء عند نفاد المفاتيح (4.3.3)
const DEFAULT_WAIT: Record<string, number> = { image: 90, video: 25, merge: 60 };
const EXPECTED_MS: Record<string, number> = { image: 45_000, video: 180_000 };

export function clampWaitSeconds(v: number | undefined, type: string): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_WAIT[type] ?? 60;
  return Math.max(0, Math.min(240, n));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => done();
    const t = setTimeout(done, ms);
    if (signal) {
      if (signal.aborted) return done();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** تقدير تقدّم زمني عندما لا يقدم المزود نسبة (يبقى تحت 92% حتى الاكتمال الفعلي) */
function estimateProgress(elapsedMs: number, type: string): number {
  const expected = EXPECTED_MS[type] ?? 90_000;
  return Math.min(92, Math.max(5, Math.round(20 + Math.min(1, elapsedMs / expected) * 70)));
}

interface RunCtx {
  task: TaskRow;
  def: ModelDef;
  args: GenArgs;
  triedKeyIds: Set<string>;
}

async function logAttempt(
  ctx: RunCtx,
  key: { id: string; provider: string; label: string },
  ok: boolean,
  errorClass?: string,
  error?: string
): Promise<void> {
  const rec: AttemptRecord = {
    provider: key.provider,
    keyId: key.id,
    keyLabel: key.label ?? "",
    ok,
    errorClass,
    error: error?.slice(0, 300),
    at: new Date().toISOString(),
  };
  await updateTask(ctx.task.id, { appendAttempt: rec });
}

type CreateOutcome =
  | { kind: "created"; providerTaskId: string; provider: string; keyId: string }
  | { kind: "sync_completed"; urls: string[]; provider: string; keyId: string }
  | { kind: "pool_exhausted" }
  | { kind: "params_failed"; error: string };

/** محاولة إنشاء المهمة على مفتاح واحد وفق سياسة التصنيف */
async function attemptCreateOnKey(ctx: RunCtx, key: { id: string; provider: string; label: string; apiKey: string }): Promise<CreateOutcome> {
  const adapter = getAdapter(key.provider);
  const providerModel = ctx.def.providerModel[key.provider as keyof typeof ctx.def.providerModel] ?? ctx.def.canonical;
  const input = adapter.buildInput(ctx.def.type as "image" | "video", ctx.args as Record<string, unknown>);
  ctx.triedKeyIds.add(key.id);

  try {
    await bumpKeyCounters(key.id, { usage: 1 });

    if (ctx.def.type === "image" && adapter.createImageSync) {
      // صور متزامنة (CometAPI): النتيجة فورية
      const r = await adapter.createImageSync(key.apiKey, providerModel, input);
      await bumpKeyCounters(key.id, { success: true });
      await logAttempt(ctx, key, true);
      await updateTask(ctx.task.id, { provider: key.provider, keyId: key.id });
      return { kind: "sync_completed", urls: r.urls, provider: key.provider, keyId: key.id };
    }

    const r = await adapter.createTask(key.apiKey, providerModel, input);
    await bumpKeyCounters(key.id, { success: true });
    await logAttempt(ctx, key, true);
    await updateTask(ctx.task.id, {
      provider: key.provider,
      providerTaskId: r.providerTaskId,
      keyId: key.id,
    });
    return { kind: "created", providerTaskId: r.providerTaskId, provider: key.provider, keyId: key.id };
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError(undefined, String(e));
    const cls = classifyProviderError(pe.status, pe.message);
    await bumpKeyCounters(key.id, { success: false, error: pe.message });
    await logAttempt(ctx, key, false, cls, pe.message);

    if (cls === "disabled") {
      // مفتاح مرفوض → تعطيل تلقائي والانتقال للتالي
      await markKeyStatus(key.id, "disabled", pe.message);
      return { kind: "pool_exhausted" };
    }
    if (cls === "exhausted") {
      // مستنزف → يبقى في القاعدة ولا يُستبعد، وننتقل للتالي
      await markKeyStatus(key.id, "exhausted", pe.message);
      return { kind: "pool_exhausted" };
    }
    if (cls === "params") {
      // معطيات الطلب خاطئة: تبديل المفاتيح لن يحلها — توقف فورًا
      return { kind: "params_failed", error: pe.message };
    }
    // provider / temporary → انتقل للمفتاح التالي دون مسّ حالة المفتاح (المؤقت) أو لمسّه (provider يبقى سليمًا)
    return { kind: "pool_exhausted" };
  }
}

/** تجربة المرشحين بالترتيب حتى أول نجاح */
async function tryCreateOnPool(ctx: RunCtx, pool: { id: string; provider: string; label: string; apiKey: string }[]): Promise<CreateOutcome> {
  for (const key of pool) {
    if (ctx.triedKeyIds.has(key.id)) continue;
    const out = await attemptCreateOnKey(ctx, key);
    if (out.kind === "pool_exhausted") continue; // جرّب التالي فورًا
    return out;
  }
  return { kind: "pool_exhausted" };
}

interface BoundTask {
  providerTaskId: string;
  provider: string;
  keyId: string;
}

type RecreateResult =
  | { ok: true; bound: BoundTask }
  | { ok: true; finished: true }
  | { ok: false }; // لا مرشحين — حالة انتظار

/**
 * إعادة إنشاء نفس المهمة (نفس task_id) على مفتاح تالٍ بعد فشل مفتاح/رصيد منتصف المهمة.
 * تجلب البركة من جديد لحظيًا فتشمل المفاتيح المضافة حديثًا وتستثني المعطلة.
 */
async function recreateOnNextKey(ctx: RunCtx, failedKeyId: string | null): Promise<RecreateResult> {
  const fresh = await getKeyPool(ctx.def.providers);
  const candidates = fresh.filter(
    (k) => k.id !== failedKeyId && !ctx.triedKeyIds.has(k.id)
  );
  if (!candidates.length) {
    // لا مرشحين: مهمة تبقى processing «بانتظار توفر مفتاح صالح…»
    await updateTask(ctx.task.id, {
      errorMessage: WAITING_MSG,
      clearProviderTaskId: true,
      provider: null,
      keyId: null,
      progress: 0,
    });
    return { ok: false };
  }
  const out = await tryCreateOnPool(ctx, candidates);
  if (out.kind === "created") {
    await updateTask(ctx.task.id, { errorMessage: null, progress: 5 });
    return { ok: true, bound: { providerTaskId: out.providerTaskId, provider: out.provider, keyId: out.keyId } };
  }
  if (out.kind === "sync_completed") {
    await updateTask(ctx.task.id, { status: "completed", resultUrls: out.urls, errorMessage: null });
    return { ok: true, finished: true };
  }
  if (out.kind === "params_failed") {
    await updateTask(ctx.task.id, { status: "failed", errorMessage: out.error });
    return { ok: true, finished: true };
  }
  await updateTask(ctx.task.id, { errorMessage: WAITING_MSG, clearProviderTaskId: true, provider: null, keyId: null });
  return { ok: false };
}

function outcomeFor(task: TaskRow): GenOutcome {
  if (task.status === "completed") return { kind: "completed", task };
  if (task.status === "failed") return { kind: "failed", task };
  return { kind: "processing", task };
}

/** نافذة الانتظار: استعلام كل 3 ثوانٍ مع بث تقدم حي وتبديل فوري عند أخطاء المفاتيح */
async function waitWindow(
  ctx: RunCtx,
  bound: BoundTask,
  onProgress?: OnProgress,
  signal?: AbortSignal
): Promise<void> {
  const waitSeconds = clampWaitSeconds(ctx.args.wait_seconds, ctx.def.type);
  if (waitSeconds <= 0) return;
  const deadline = Date.now() + waitSeconds * 1000;
  const startedAt = Date.now();
  let current = bound;
  let notified = false;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal?.aborted) return;

    const key = await getKeyById(current.keyId);
    if (!key || key.status === "disabled") {
      // حُذف المفتاح أو عُطّل أثناء الطيران → أنشئ على التالي فورًا
      const r = await recreateOnNextKey(ctx, current.keyId);
      if (!r.ok) return;
      if (r.ok && "finished" in r) return;
      current = r.bound;
      continue;
    }

    const adapter = getAdapter(key.provider);
    let res: CheckResult;
    try {
      res = await adapter.checkTask(key.apiKey, current.providerTaskId);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(undefined, String(e));
      const cls = classifyProviderError(pe.status, pe.message);
      if (cls === "disabled" || cls === "exhausted" || cls === "provider") {
        if (cls !== "provider") await markKeyStatus(key.id, cls, pe.message);
        await logAttempt(ctx, key, false, cls, pe.message);
        const r = await recreateOnNextKey(ctx, key.id);
        if (!r.ok) return;
        if (r.ok && "finished" in r) return;
        current = r.bound;
        continue;
      }
      // temporary/params أثناء الاستعلام: استعلام الحالة لا يعتمد على معطيات المستخدم،
      // فنعتبر الشذوذ مؤقتًا ونكمل الاستعلام على نفس مهمة المزود.
      continue;
    }

    if (res.status === "completed" && res.urls?.length) {
      await updateTask(ctx.task.id, { status: "completed", resultUrls: res.urls, errorMessage: null });
      await onProgress?.(100, "اكتمل التوليد");
      return;
    }
    if (res.status === "failed") {
      const msg = res.error || "فشل غير معروف لدى المزود";
      if (KEY_OR_BALANCE_PATTERN.test(msg)) {
        // فشل منتصف المهمة بسبب مفتاح/رصيد → نفس المهمة على المفتاح التالي بصمت
        await logAttempt(ctx, key, false, classifyProviderError(undefined, msg), msg);
        const r = await recreateOnNextKey(ctx, key.id);
        if (!r.ok) return;
        if (r.ok && "finished" in r) return;
        current = r.bound;
        continue;
      }
      // فشل حقيقي (سياسة محتوى/معطيات لدى المزود) — يُعرض سببه
      await updateTask(ctx.task.id, { status: "failed", errorMessage: msg.slice(0, 500) });
      return;
    }

    // قيد المعالجة: اكتب التقدم وابثه حيًا
    const pct = res.progress ?? estimateProgress(Date.now() - startedAt, ctx.def.type);
    await updateTask(ctx.task.id, { progress: pct });
    if (!notified) {
      notified = true;
      await onProgress?.(pct, "بدأ التوليد…");
    }
    await onProgress?.(pct, `قيد التوليد… ${pct}%`);
  }
}

/** التدفق الكامل لأداة generate_image / generate_video (قسم 6) */
export async function runGeneration(
  type: Exclude<TaskType, "merge">,
  args: GenArgs,
  onProgress?: OnProgress,
  signal?: AbortSignal
): Promise<GenOutcome> {
  await ensureSchema();

  // 1) توحيد اسم الموديل عبر aliases — غير معروف → خطأ معطيات فوري
  const def = findModel(args.model, type);
  if (!def) {
    throw new ParamsValidationError(
      `موديل غير معروف: ${args.model}. المتاح: gpt-image-2-6/flare-text-to-image (صور) و grok-imagine-video-1-5-preview (فيديو).`
    );
  }

  // 2) بركة المفاتيح بالترتيب التسلسلي — فارغة → رد no_keys
  const pool = await getKeyPool(def.providers);
  if (!pool.length) return { kind: "no_keys", model: def.canonical };

  // 3) سجّل المهمة في Turso قبل أي نداء خارجي — تبقى قابلة للتتبع حتى لو انقطع الاتصال
  const task = await insertTask({
    type,
    model: def.canonical,
    prompt: args.prompt ?? "",
    paramsJson: JSON.stringify(args),
  });
  const ctx: RunCtx = { task, def, args, triedKeyIds: new Set() };

  // 4) جرّب المرشحين بالترتيب حتى نجاح الإنشاء
  const created = await tryCreateOnPool(ctx, pool);

  if (created.kind === "params_failed") {
    await updateTask(task.id, { status: "failed", errorMessage: created.error.slice(0, 500) });
    return outcomeFor((await getTask(task.id))!);
  }
  if (created.kind === "pool_exhausted") {
    // كل المفاتيح فشلت → تبقى processing «بانتظار توفر مفتاح صالح…»
    await updateTask(task.id, { errorMessage: WAITING_MSG });
    return outcomeFor((await getTask(task.id))!);
  }
  if (created.kind === "sync_completed") {
    await updateTask(task.id, { status: "completed", resultUrls: created.urls });
    await onProgress?.(100, "اكتمل التوليد");
    return outcomeFor((await getTask(task.id))!);
  }

  // 5) نافذة الانتظار مع بث التقدم
  await waitWindow(ctx, { providerTaskId: created.providerTaskId, provider: created.provider, keyId: created.keyId }, onProgress, signal);

  // 6) انتهت النافذة: أعِد الحالة الحالية (غالبًا processing والعميل يتابع بـ get_task)
  return outcomeFor((await getTask(task.id))!);
}

/**
 * get_task → تحديث حي من المزود/خدمة الدمج مع نفس منطق التبديل، ثم إعادة المهمة.
 * تُستدعى من أداة get_task كل ~10 ثوانٍ من العميل.
 */
export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  await ensureSchema();
  const task = await getTask(taskId);
  if (!task) return null;
  if (task.type === "merge") return refreshMergeTask(task);
  if (task.status === "completed" || task.status === "failed") return task;

  const def = findModel(task.model, task.type === "image" ? "image" : "video") ?? findModel(undefined, task.type === "image" ? "image" : "video")!;
  const args: GenArgs = (() => {
    try {
      return JSON.parse(task.paramsJson) as GenArgs;
    } catch {
      return {};
    }
  })();
  const ctx: RunCtx = { task, def, args, triedKeyIds: new Set() };

  // أ) لم يُنجز الإنشاء قط (فشل على كل المفاتيح سابقًا) → إعادة محاولة بعد تهدئة 45 ثانية
  if (!task.providerTaskId) {
    const since = Date.now() - parseSqliteDate(task.updatedAt);
    if (since < CREATE_COOLDOWN_MS) return task;
    const pool = await getKeyPool(def.providers);
    if (!pool.length) {
      await updateTask(task.id, { errorMessage: WAITING_MSG });
      return (await getTask(task.id))!;
    }
    const out = await tryCreateOnPool(ctx, pool);
    if (out.kind === "created") {
      await updateTask(task.id, { errorMessage: null, progress: 5 });
    } else if (out.kind === "sync_completed") {
      await updateTask(task.id, { status: "completed", resultUrls: out.urls });
    } else if (out.kind === "params_failed") {
      await updateTask(task.id, { status: "failed", errorMessage: out.error.slice(0, 500) });
    } else {
      await updateTask(task.id, { errorMessage: WAITING_MSG });
    }
    return (await getTask(task.id))!;
  }

  // ب) مهمة جارية لدى مزود — حدّثها حيًا
  const key = task.keyId ? await getKeyById(task.keyId) : null;
  if (!key || key.status === "disabled") {
    // المفتاح حُذف أو عُطّل → أعد الإنشاء على مفتاح آخر بنفس task_id
    const r = await recreateOnNextKey(ctx, key?.id ?? null);
    return (await getTask(task.id))!;
  }

  const adapter = getAdapter(key.provider);
  let res: CheckResult;
  try {
    res = await adapter.checkTask(key.apiKey, task.providerTaskId);
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError(undefined, String(e));
    const cls = classifyProviderError(pe.status, pe.message);
    if (cls === "disabled" || cls === "exhausted" || cls === "provider") {
      if (cls !== "provider") await markKeyStatus(key.id, cls, pe.message);
      await logAttempt(ctx, key, false, cls, pe.message);
      await recreateOnNextKey(ctx, key.id);
    }
    // temporary → ابقَ processing، العميل سيعيد الاستعلام
    return (await getTask(task.id))!;
  }

  if (res.status === "completed" && res.urls?.length) {
    await updateTask(task.id, { status: "completed", resultUrls: res.urls, errorMessage: null });
    return (await getTask(task.id))!;
  }
  if (res.status === "failed") {
    const msg = res.error || "فشل غير معروف لدى المزود";
    if (KEY_OR_BALANCE_PATTERN.test(msg)) {
      await logAttempt(ctx, key, false, classifyProviderError(undefined, msg), msg);
      await recreateOnNextKey(ctx, key.id);
    } else {
      await updateTask(task.id, { status: "failed", errorMessage: msg.slice(0, 500) });
    }
    return (await getTask(task.id))!;
  }
  // processing → حدّث النسبة
  const elapsed = Date.now() - parseSqliteDate(task.createdAt);
  const pct = res.progress ?? estimateProgress(elapsed, task.type);
  if (pct > task.progress) await updateTask(task.id, { progress: pct });
  return (await getTask(task.id))!;
}
