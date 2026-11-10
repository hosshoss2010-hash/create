"use client";

// لوحة المهام: شرائح إحصائيات + قائمة حية تتحدث كل ~5 ثوانٍ
import { useCallback, useEffect, useState } from "react";

export interface TaskItem {
  id: string;
  type: "image" | "video" | "merge";
  model: string;
  provider: string | null;
  prompt: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  resultUrls: string[] | null;
  errorMessage: string | null;
  attemptsCount: number;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = { image: "🖼️ صورة", video: "🎬 فيديو", merge: "🎞️ دمج" };
const STATUS_LABEL: Record<string, string> = {
  pending: "انتظار",
  processing: "قيد المعالجة",
  completed: "مكتملة",
  failed: "فاشلة",
};
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-600",
  processing: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

function fmtTime(sqlite: string): string {
  const t = Date.parse(sqlite?.includes("T") ? sqlite : sqlite?.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return sqlite || "-";
  return new Intl.DateTimeFormat("ar", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(new Date(t));
}

export default function TasksCard() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, failed: 0, processing: 0 });

  const load = useCallback(() => {
    fetch("/api/tasks?limit=20")
      .then((r) => r.json())
      .then((d) => {
        setTasks(d.tasks ?? []);
        setStats(d.stats ?? { total: 0, completed: 0, failed: 0, processing: 0 });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000); // تحديث تلقائي كل 5 ثوانٍ
    return () => clearInterval(t);
  }, [load]);

  const chips = [
    { label: "الإجمالي", value: stats.total, cls: "bg-zinc-900 text-white" },
    { label: "مكتملة", value: stats.completed, cls: "bg-emerald-100 text-emerald-700" },
    { label: "فاشلة", value: stats.failed, cls: "bg-red-100 text-red-700" },
    { label: "جارية", value: stats.processing, cls: "bg-sky-100 text-sky-700" },
  ];

  return (
    <section className="bg-white rounded-2xl border shadow-sm p-5" aria-label="لوحة المهام">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold flex items-center gap-2">📋 لوحة المهام</h2>
        <span className="text-[11px] text-zinc-400">تتحدث تلقائيًا كل 5 ثوانٍ</span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {chips.map((c) => (
          <div key={c.label} className={`rounded-xl px-2 py-2.5 text-center ${c.cls}`}>
            <div className="text-lg font-extrabold">{c.value}</div>
            <div className="text-[11px] opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 max-h-96 overflow-y-auto grid gap-2">
        {tasks.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-6">لا توجد مهام بعد — جرّب التوليد من عميل MCP.</p>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-xl border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{TYPE_LABEL[t.type] ?? t.type}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[t.status]}`}>
                {STATUS_LABEL[t.status]}
              </span>
              <code className="text-[11px] text-zinc-500 font-mono" dir="ltr">{t.model}</code>
              <span className="text-[11px] text-zinc-400 ms-auto">{fmtTime(t.createdAt)}</span>
            </div>

            {(t.status === "processing" || t.status === "pending") && (
              <div className="mt-2 h-2 rounded-full bg-zinc-100 overflow-hidden" dir="ltr">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${Math.max(3, t.progress)}%` }}
                />
              </div>
            )}

            {t.prompt && (
              <p className="mt-1.5 text-xs text-zinc-600 line-clamp-2" dir="auto">{t.prompt}</p>
            )}

            {t.status === "completed" && t.resultUrls && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.resultUrls.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-bold"
                  >
                    {t.type === "image" ? "فتح الصورة ↗" : t.type === "video" ? "فتح الفيديو ↗" : "فتح الدمج ↗"}
                  </a>
                ))}
              </div>
            )}

            {t.status === "failed" && t.errorMessage && (
              <p className="mt-1.5 text-xs text-red-600">{t.errorMessage}</p>
            )}

            <div className="mt-1 text-[11px] text-zinc-400 flex flex-wrap gap-x-3">
              <span>المحاولات: {t.attemptsCount}</span>
              <span dir="ltr" className="font-mono">task: {t.id.slice(0, 8)}…</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
