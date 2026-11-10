// ============================================================
// طبقة قاعدة البيانات — Turso (libsql) عبر HTTP فقط.
// متوافقة مع Vercel serverless: لا ملفات SQLite محلية إطلاقًا.
// المخطط يُنشأ عند أول وصول (CREATE TABLE IF NOT EXISTS) بلا migrations.
// ============================================================
import { createClient, type Client, type InValue } from "@libsql/client";
import { randomUUID } from "node:crypto";

let _client: Client | null = null;
let _schemaPromise: Promise<void> | null = null;

export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
      throw new Error("متغيرات البيئة TURSO_DATABASE_URL / TURSO_AUTH_TOKEN غير مضبوطة");
    }
    _client = createClient({ url, authToken });
  }
  return _client;
}

export async function ensureSchema(): Promise<void> {
  if (!_schemaPromise) {
    _schemaPromise = (async () => {
      const db = getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          provider TEXT,
          provider_task_id TEXT,
          key_id TEXT,
          model TEXT NOT NULL,
          type TEXT NOT NULL,
          prompt TEXT DEFAULT '',
          params_json TEXT DEFAULT '{}',
          status TEXT NOT NULL,
          progress INTEGER DEFAULT 0,
          result_urls_json TEXT,
          error_message TEXT,
          attempts_json TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT
        )`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT DEFAULT '',
          api_key TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          usage_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          fail_count INTEGER DEFAULT 0,
          last_used_at TEXT,
          last_checked_at TEXT,
          last_error TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`);
    })().catch((e) => {
      _schemaPromise = null; // اسمح بإعادة المحاولة عند النداء التالي
      throw e;
    });
  }
  return _schemaPromise;
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await getDb().execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// ===== تشخيص الاتصال — يكشف السبب الدقيق لفشل الوصول للقاعدة =====
// آمن: يعرض بادئة الرابط وطول التوكن فقط، ولا يعرض التوكن أبدًا.

export interface DbDiagnosis {
  urlSet: boolean;
  urlPrefix: string;
  tokenSet: boolean;
  tokenLength: number;
  connected: boolean;
  error: string | null;
}

export async function diagnoseDb(): Promise<DbDiagnosis> {
  const url = (process.env.TURSO_DATABASE_URL ?? "").trim();
  const token = (process.env.TURSO_AUTH_TOKEN ?? "").trim();
  const diag: DbDiagnosis = {
    urlSet: url.length > 0,
    urlPrefix: url ? url.slice(0, 40) : "",
    tokenSet: token.length > 0,
    tokenLength: token.length,
    connected: false,
    error: null,
  };

  if (!url || !token) {
    diag.error = !url && !token
      ? "❌ المتغيران TURSO_DATABASE_URL و TURSO_AUTH_TOKEN غير موجودين على الخادم — أضفهما في إعدادات المشروع ثم اعمل Redeploy"
      : !url
        ? "❌ المتغير TURSO_DATABASE_URL غير موجود على الخادم — أضفه ثم اعمل Redeploy"
        : "❌ المتغير TURSO_AUTH_TOKEN غير موجود على الخادم — أضفه ثم اعمل Redeploy";
    return diag;
  }

  try {
    const c = createClient({ url, authToken: token });
    await c.execute("SELECT 1");
    diag.connected = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // لا نعرض التوكن أبدًا حتى لو ظهر في رسالة الخطأ
    diag.error = (token ? msg.split(token).join("•••") : msg).slice(0, 300);
  }
  return diag;
}

// ===== أنواع السجلات =====

export interface AttemptRecord {
  provider: string;
  keyId: string | null;
  keyLabel: string;
  ok: boolean;
  errorClass?: string;
  error?: string;
  at: string;
}

export type TaskStatus = "pending" | "processing" | "completed" | "failed";
export type TaskType = "image" | "video" | "merge";

export interface TaskRow {
  id: string;
  provider: string | null;
  providerTaskId: string | null;
  keyId: string | null;
  model: string;
  type: TaskType;
  prompt: string;
  paramsJson: string;
  status: TaskStatus;
  progress: number;
  resultUrls: string[] | null;
  errorMessage: string | null;
  attempts: AttemptRecord[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface KeyRow {
  id: string;
  provider: string;
  label: string;
  apiKey: string;
  status: "active" | "exhausted" | "disabled" | string;
  usageCount: number;
  successCount: number;
  failCount: number;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

 
function rowToTask(r: Record<string, any>): TaskRow {
  return {
    id: String(r.id),
    provider: r.provider ?? null,
    providerTaskId: r.provider_task_id ?? null,
    keyId: r.key_id ?? null,
    model: String(r.model ?? ""),
    type: r.type as TaskType,
    prompt: String(r.prompt ?? ""),
    paramsJson: String(r.params_json ?? "{}"),
    status: r.status as TaskStatus,
    progress: Number(r.progress ?? 0),
    resultUrls: safeParse<string[] | null>(r.result_urls_json, null),
    errorMessage: r.error_message ?? null,
    attempts: safeParse<AttemptRecord[]>(r.attempts_json, []),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    completedAt: r.completed_at ?? null,
  };
}

function rowToKey(r: Record<string, any>): KeyRow {
  return {
    id: String(r.id),
    provider: String(r.provider),
    label: String(r.label ?? ""),
    apiKey: String(r.api_key ?? ""),
    status: String(r.status ?? "active"),
    usageCount: Number(r.usage_count ?? 0),
    successCount: Number(r.success_count ?? 0),
    failCount: Number(r.fail_count ?? 0),
    lastUsedAt: r.last_used_at ?? null,
    lastCheckedAt: r.last_checked_at ?? null,
    lastError: r.last_error ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}
 

export function parseSqliteDate(s: string | null | undefined): number {
  // SQLite datetime('now') = "YYYY-MM-DD HH:MM:SS" بتوقيت UTC
  if (!s) return 0;
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? 0 : t;
}

// ===== عمليات المهام =====

export async function insertTask(input: {
  type: TaskType;
  model: string;
  prompt?: string;
  paramsJson?: string;
  provider?: string | null;
  providerTaskId?: string | null;
  keyId?: string | null;
  status?: TaskStatus;
}): Promise<TaskRow> {
  await ensureSchema();
  const id = randomUUID();
  await getDb().execute({
    sql: `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.provider ?? null,
      input.providerTaskId ?? null,
      input.keyId ?? null,
      input.model,
      input.type,
      input.prompt ?? "",
      input.paramsJson ?? "{}",
      input.status ?? "processing", // نبدأ بـ processing مباشرة؛ الفشل الكامل للمفاتيح يبقى processing (قاعدة 4.3.3)
    ],
  });
  return (await getTask(id))!;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  await ensureSchema();
  const rs = await getDb().execute({ sql: "SELECT * FROM tasks WHERE id = ?", args: [id] });
  return rs.rows.length ? rowToTask(rs.rows[0] as Record<string, unknown>) : null;
}

export interface TaskPatch {
  status?: TaskStatus;
  progress?: number;
  provider?: string | null;
  providerTaskId?: string | null;
  keyId?: string | null;
  errorMessage?: string | null;
  resultUrls?: string[];
  paramsJson?: string;
  appendAttempt?: AttemptRecord;
  clearProviderTaskId?: boolean;
}

/** تحديث جزئي للمهمة: يضيف المحاولات ويضبط completed_at/progress=100 تلقائيًا عند الاكتمال */
export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  await ensureSchema();
  const sets: string[] = [];
  const args: InValue[] = [];

  if (patch.status) {
    sets.push("status = ?");
    args.push(patch.status);
    if (patch.status === "completed") {
      // عند الاكتمال: progress=100 و completed_at تلقائيًا
      sets.push("progress = 100");
      sets.push("completed_at = datetime('now')");
    }
  }
  if (typeof patch.progress === "number" && patch.status !== "completed") {
    sets.push("progress = ?");
    args.push(Math.max(0, Math.min(100, Math.round(patch.progress))));
  }
  if (patch.provider !== undefined) {
    sets.push("provider = ?");
    args.push(patch.provider);
  }
  if (patch.clearProviderTaskId) {
    sets.push("provider_task_id = NULL");
  } else if (patch.providerTaskId !== undefined) {
    sets.push("provider_task_id = ?");
    args.push(patch.providerTaskId);
  }
  if (patch.keyId !== undefined) {
    sets.push("key_id = ?");
    args.push(patch.keyId);
  }
  if (patch.errorMessage !== undefined) {
    sets.push("error_message = ?");
    args.push(patch.errorMessage);
  }
  if (patch.resultUrls !== undefined) {
    sets.push("result_urls_json = ?");
    args.push(JSON.stringify(patch.resultUrls));
  }
  if (patch.paramsJson !== undefined) {
    sets.push("params_json = ?");
    args.push(patch.paramsJson);
  }
  if (patch.appendAttempt) {
    // قراءة-تعديل-كتابة: نضمن بقاء سجل المحاولات الكامل
    const cur = await getTask(id);
    const arr = cur?.attempts ?? [];
    arr.push({ ...patch.appendAttempt, at: patch.appendAttempt.at || new Date().toISOString() });
    sets.push("attempts_json = ?");
    args.push(JSON.stringify(arr));
  }

  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  args.push(id);
  await getDb().execute({ sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, args });
}

export async function listRecentTasks(
  limit = 10,
  filter?: { type?: string; status?: string }
): Promise<TaskRow[]> {
  await ensureSchema();
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter?.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter?.status) {
    if (filter.status === "processing") {
      where.push("status IN ('pending','processing')");
    } else {
      where.push("status = ?");
      args.push(filter.status);
    }
  }
  args.push(Math.max(1, Math.min(50, limit)));
  const rs = await getDb().execute({
    sql: `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC LIMIT ?`,
    args,
  });
  return rs.rows.map((r) => rowToTask(r as Record<string, unknown>));
}

export async function taskStats(): Promise<{
  total: number;
  completed: number;
  failed: number;
  processing: number;
}> {
  await ensureSchema();
  const rs = await getDb().execute(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END), 0) AS processing
    FROM tasks`);
  const r = rs.rows[0] as Record<string, unknown>;
  return {
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    processing: Number(r.processing ?? 0),
  };
}

// ===== عمليات المفاتيح =====

export async function insertKey(input: {
  provider: string;
  apiKey: string;
  label?: string;
}): Promise<KeyRow> {
  await ensureSchema();
  const id = randomUUID();
  await getDb().execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key) VALUES (?, ?, ?, ?)`,
    args: [id, input.provider, input.label ?? "", input.apiKey],
  });
  return (await getKeyById(id))!;
}

export async function listKeys(): Promise<KeyRow[]> {
  await ensureSchema();
  // نفس ترتيب التجربة التسلسلي (الأحدث إضافة هو الأخير تجربة)
  const rs = await getDb().execute(
    `SELECT * FROM api_keys ORDER BY created_at ASC, id ASC`
  );
  return rs.rows.map((r) => rowToKey(r as Record<string, unknown>));
}

export async function getKeyById(id: string): Promise<KeyRow | null> {
  await ensureSchema();
  const rs = await getDb().execute({ sql: "SELECT * FROM api_keys WHERE id = ?", args: [id] });
  return rs.rows.length ? rowToKey(rs.rows[0] as Record<string, unknown>) : null;
}

export async function findKeyBySecret(provider: string, apiKey: string): Promise<KeyRow | null> {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: "SELECT * FROM api_keys WHERE provider = ? AND api_key = ? LIMIT 1",
    args: [provider, apiKey],
  });
  return rs.rows.length ? rowToKey(rs.rows[0] as Record<string, unknown>) : null;
}

export async function deleteKey(id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [id] });
}
