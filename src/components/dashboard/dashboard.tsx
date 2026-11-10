"use client";

// لوحة الإدارة الرئيسية — هيدر بحالة الصحة + ثلاث بطاقات (مفاتيح / مهام / ربط)
import { useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import KeysCard from "./keys-card";
import TasksCard from "./tasks-card";
import ConnectCard from "./connect-card";

export interface HealthState {
  ok: boolean;
  database: string;
  mcpEndpoint: string;
  models: { canonical: string; type: string; providers: string[] }[];
  merger: { base: string; healthy: boolean };
  authRequired: boolean;
}

export default function Dashboard() {
  const [health, setHealth] = useState<HealthState | null>(null);

  const loadHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    loadHealth();
    const t = setInterval(loadHealth, 15_000);
    return () => clearInterval(t);
  }, [loadHealth]);

  const dbOk = health?.ok === true;
  const mergerHealthy = health?.merger?.healthy === true;

  return (
    <div className="min-h-screen flex flex-col">
      <Toaster richColors position="bottom-right" dir="rtl" />

      {/* الهيدر: شارة حالة Turso + خدمة الدمج */}
      <header className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold flex items-center gap-2">
              🎬 MCP Media Generator
            </h1>
            <p className="text-sm text-zinc-500">
              توليد الصور والفيديو بالذكاء الاصطناعي + دمج المقاطع — تبديل تسلسلي تلقائي للمفاتيح
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                dbOk ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              }`}
              title={health?.database ?? "جارٍ الفحص…"}
            >
              <span className={`h-2 w-2 rounded-full ${dbOk ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              {dbOk ? "Turso متصل" : "Turso غير متصل"}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                mergerHealthy ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
              title={health?.merger?.base || "MERGER_API_BASE غير مضبوط"}
            >
              <span className={`h-2 w-2 rounded-full ${mergerHealthy ? "bg-emerald-500" : "bg-amber-500"}`} />
              {mergerHealthy ? "خدمة الدمج جاهزة" : "خدمة الدمج غير مربوطة"}
            </span>
            {health?.authRequired && (
              <span className="rounded-full bg-zinc-900 text-white px-3 py-1 text-xs font-bold">
                محمي بـ Bearer Token
              </span>
            )}
          </div>
        </div>
      </header>

      {/* البطاقات الثلاث */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-2 items-start">
        <KeysCard />
        <TasksCard />
        <div className="lg:col-span-2">
          <ConnectCard authRequired={health?.authRequired === true} />
        </div>
      </main>

      <footer className="mt-auto border-t bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 text-xs text-zinc-500 leading-6">
          MCP Media Generator v1.2.0 — تُخزَّن روابط النتائج فقط ولا تُنزَّل أي وسائط على السيرفر ·
          المفاتيح تُجرَّب تسلسليًا بترتيب الإضافة مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد ·
          مفاتيح API مخفية دائمًا في كل الاستجابات.
        </div>
      </footer>
    </div>
  );
}
