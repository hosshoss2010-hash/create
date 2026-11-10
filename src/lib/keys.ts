// ============================================================
// نظام المفاتيح المتسلسلة — قلب المشروع (قسم 4 من المواصفة)
// - ترتيب تجربة صارم حسب ترتيب الإضافة (created_at ASC, id ASC) — ليس round-robin
// - تصنيف موحد لأخطاء المزودين مع إجراء تلقائي لكل فئة
// - إخفاء المفاتيح (maskKey) إلزامي في كل الاستجابات
// ============================================================
import { getDb, ensureSchema, type KeyRow } from "./turso";

export type ErrorClass = "disabled" | "exhausted" | "provider" | "params" | "temporary";

/** نمط أخطاء المفتاح/الرصيد — يُستخدم أيضًا لاكتشاف فشل منتصف المهمة (4.3.2) */
export const KEY_OR_BALANCE_PATTERN =
  /insufficient|balance|credit|quota|out of credits|exhausted|充值|402|401|unauthorized|forbidden|invalid api key/i;

/**
 * تصنيف موحد لأخطاء المزودين:
 * disabled  → المفتاح مرفوض: عطّله تلقائيًا وانتقل للتالي
 * exhausted → نفاد الرصيد: علّمه exhausted (يبقى في القاعدة) وانتقل للتالي
 * provider  → الموديل غير مدعوم لدى هذا المزود: انتقل للتالي دون لمس المفتاح
 * params    → خطأ في معطيات الطلب: توقف فورًا (تبديل المفاتيح لن يحلّه)
 * temporary → 429/5xx/شبكة/timeout: انتقل للتالي الآن والمفتاح يبقى سليمًا
 *
 * ملاحظة: نفاد الرصيد يُفحص قبل حالة 400 لأن بعض المزودين يرسلونه بحالة 400.
 */
export function classifyProviderError(
  status: number | undefined,
  message: string
): ErrorClass {
  const m = (message || "").toLowerCase();
  const has = (re: RegExp) => re.test(m);

  // 1) مفتاح مرفوض (401/403 أو رسالة توثيق)
  if (status === 401 || status === 403 || has(/invalid api key|unauthorized|forbidden|authentication/)) {
    return "disabled";
  }
  // 2) نفاد الرصيد — قبل فحص 400 عمدًا
  if (status === 402 || has(/insufficient|quota|balance|credit|out of credits|exhausted|充值/)) {
    return "exhausted";
  }
  // 3) موديل غير مدعوم لدى المزود
  if (has(/model not found|unsupported model/) && (status === 400 || status === 404 || status === 422)) {
    return "provider";
  }
  // 4) خطأ معطيات
  if (status === 400 || status === 422) return "params";
  // 5) كل الباقي مؤقت (429، 5xx، انقطاع شبكة، timeout)
  return "temporary";
}

/** إخفاء المفتاح دائمًا: أول 7 + نقاط + آخر 4 (وللمفاتيح القصيرة أول 3 + نقاط) */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 14) return key.slice(0, 3) + "••••";
  return key.slice(0, 7) + "••••••••" + key.slice(-4);
}

/**
 * تجلب مفاتيح المزودين المطلوبين بترتيب تسلسلي صارم حسب الإضافة.
 * المفتاح المستنزف (exhausted) يبقى في القائمة — الاستثناء الوحيد هو التعطيل اليدوي (disabled).
 */
export async function getKeyPool(providers: string[]): Promise<KeyRow[]> {
  await ensureSchema();
  if (!providers.length) return [];
  const ph = providers.map(() => "?").join(", ");
  const rs = await getDb().execute({
    sql: `SELECT * FROM api_keys
          WHERE status != 'disabled' AND provider IN (${ph})
          ORDER BY created_at ASC, id ASC`,
    args: providers,
  });
  return rs.rows.map((r) => {
    const k = r as Record<string, unknown>;
    return {
      id: String(k.id),
      provider: String(k.provider),
      label: String(k.label ?? ""),
      apiKey: String(k.api_key ?? ""),
      status: String(k.status ?? "active"),
      usageCount: Number(k.usage_count ?? 0),
      successCount: Number(k.success_count ?? 0),
      failCount: Number(k.fail_count ?? 0),
      lastUsedAt: (k.last_used_at as string) ?? null,
      lastCheckedAt: (k.last_checked_at as string) ?? null,
      lastError: (k.last_error as string) ?? null,
      createdAt: String(k.created_at ?? ""),
    };
  });
}

/** تعليم المفتاح بحالة جديدة (disabled/exhausted) مع سبب آخر خطأ */
export async function markKeyStatus(
  id: string,
  status: "disabled" | "exhausted" | "active",
  lastError?: string
): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE api_keys SET status = ?, last_error = COALESCE(?, last_error), last_checked_at = datetime('now') WHERE id = ?`,
    args: [status, lastError ?? null, id],
  });
}

/** تحديث عدّادات المفتاح بعد كل محاولة (تُحدَّث دائمًا) */
export async function bumpKeyCounters(
  id: string,
  opts: { usage?: number; success?: boolean; error?: string }
): Promise<void> {
  await ensureSchema();
  const sets: string[] = ["last_used_at = datetime('now')", "last_checked_at = datetime('now')"];
  const args: (string | number)[] = [];
  if (opts.usage) {
    sets.push("usage_count = usage_count + ?");
    args.push(opts.usage);
  }
  if (opts.success === true) {
    sets.push("success_count = success_count + 1");
    sets.push("last_error = NULL");
  }
  if (opts.success === false) {
    sets.push("fail_count = fail_count + 1");
    if (opts.error) {
      sets.push("last_error = ?");
      args.push(opts.error.slice(0, 300));
    }
  }
  args.push(id);
  await getDb().execute({ sql: `UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`, args });
}
