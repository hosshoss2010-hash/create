// ============================================================
// صياغة الردود العربية لأدوات MCP (قسم 8 من المواصفة)
// القاعدة الذهبية 4: نموذج الذكاء الاصطناعي لا يرى أخطاء المفاتيح/الرصيد أبدًا.
// ============================================================
import { KEY_OR_BALANCE_PATTERN } from "./keys";
import type { TaskRow } from "./turso";
import type { GenOutcome } from "./generation";
import type { MergeOutcome } from "./merger";

/** تنظيف رسالة الخطأ قبل خروجها للعميل: لا ذِر لمفاتيح أو رصيد */
export function sanitizeError(msg: string): string {
  if (KEY_OR_BALANCE_PATTERN.test(msg)) {
    return "خطأ مؤقت في مزود التوليد — ستُستأنف المهمة تلقائيًا.";
  }
  return msg;
}

export function formatGenerationCompleted(task: TaskRow): string {
  const urls = task.resultUrls ?? [];
  if (task.type === "image") {
    const u = urls[0] ?? "";
    return `✅ تم توليد الصورة بنجاح\n\n![image](${u})\n\nالرابط المباشر: ${u}`;
  }
  const lines = urls.map((u) => `- ${u}`).join("\n");
  return `✅ تم توليد الفيديو بنجاح\n\nالروابط المباشرة:\n${lines || "-"}`;
}

export function formatMergeCompleted(task: TaskRow): string {
  const u = (task.resultUrls ?? [])[0] ?? "";
  return (
    `✅ تم دمج المقاطع بنجاح\n\nالرابط المباشر: ${u}\n\n` +
    `⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.`
  );
}

export function formatProcessing(task: TaskRow): string {
  const pct = task.progress ? ` (${task.progress}%)` : "";
  return (
    `⏳ المهمة قيد المعالجة — task_id: ${task.id}${pct}\n\n` +
    `تابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.`
  );
}

export function formatFailed(task: TaskRow): string {
  return `❌ فشلت المهمة: ${sanitizeError(task.errorMessage || "سبب غير معروف")}`;
}

const TYPE_LABEL: Record<string, string> = {
  image: "🖼️ صورة",
  video: "🎬 فيديو",
  merge: "🎞️ دمج",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "⏳ قيد الانتظار",
  processing: "⏳ قيد المعالجة",
  completed: "✅ مكتملة",
  failed: "❌ فاشلة",
};

function fmtDate(sqlite: string): string {
  const t = Date.parse(sqlite?.includes("T") ? sqlite : sqlite?.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return sqlite || "-";
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(t)) + " (UTC)";
}

export function formatList(tasks: TaskRow[]): string {
  if (!tasks.length) {
    return "لا توجد وسائط مخزنة بعد. ولّد صورة أو فيديو أو ادمج مقاطع، ثم ستجدها هنا مع روابطها.";
  }
  const lines = tasks.map((t, i) => {
    let line = `${i + 1}) ${TYPE_LABEL[t.type] ?? t.type} — ${t.model} — ${fmtDate(t.createdAt)} — ${STATUS_LABEL[t.status] ?? t.status}`;
    if (t.status === "processing" && t.progress) line += ` (${t.progress}%)`;
    if (t.status === "completed" && t.resultUrls?.length) {
      line += `\n   الرابط: ${t.resultUrls.join(" ، ")}`;
      if (t.type === "merge") line += "\n   ⚠️ يُحذف الملف بعد ~24 ساعة — نزّله سريعًا.";
    }
    if (t.status === "failed" && t.errorMessage) line += `\n   السبب: ${sanitizeError(t.errorMessage)}`;
    line += `\n   task_id: ${t.id}`;
    return line;
  });
  return `📁 أحدث الوسائط المخزنة (${tasks.length}) — مرتبة من الأحدث:\n\n${lines.join("\n\n")}`;
}

/** تحويل ناتج runGeneration إلى نص عربي جاهز للعرض */
export function textForGenOutcome(outcome: GenOutcome): { text: string; isError: boolean } {
  switch (outcome.kind) {
    case "no_keys":
      return {
        text: `❌ لا توجد مفاتيح نشطة لخدمة ${outcome.model}. أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة، ثم أعد المحاولة.`,
        isError: true,
      };
    case "completed":
      return { text: formatGenerationCompleted(outcome.task), isError: false };
    case "failed":
      return { text: formatFailed(outcome.task), isError: true };
    default:
      return { text: formatProcessing(outcome.task), isError: false };
  }
}

/** تحويل ناتج runMerge إلى نص عربي جاهز للعرض */
export function textForMergeOutcome(outcome: MergeOutcome): { text: string; isError: boolean } {
  switch (outcome.kind) {
    case "completed":
      return { text: formatMergeCompleted(outcome.task), isError: false };
    case "failed":
      return { text: formatFailed(outcome.task), isError: true };
    default:
      return { text: formatProcessing(outcome.task), isError: false };
  }
}

/** تحويل مهمة (get_task) إلى نص عربي حسب حالتها */
export function textForTask(task: TaskRow): { text: string; isError: boolean } {
  if (task.status === "completed") {
    return task.type === "merge"
      ? { text: formatMergeCompleted(task), isError: false }
      : { text: formatGenerationCompleted(task), isError: false };
  }
  if (task.status === "failed") return { text: formatFailed(task), isError: true };
  return { text: formatProcessing(task), isError: false };
}
