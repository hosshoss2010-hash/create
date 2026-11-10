"use client";

// بطاقة مدير المفاتيح: إضافة/تعطيل/تنشيط/حذف — عرض مقنّع دائمًا مع عدّادات
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface KeyItem {
  id: string;
  provider: string;
  label: string;
  maskedKey: string;
  status: string;
  usageCount: number;
  successCount: number;
  failCount: number;
  lastUsedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const PROVIDER_LABEL: Record<string, string> = { kie: "kie.ai", cometapi: "CometAPI" };

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    exhausted: "bg-amber-100 text-amber-700",
    disabled: "bg-zinc-200 text-zinc-600",
  };
  const label: Record<string, string> = {
    active: "نشط",
    exhausted: "مستنزف",
    disabled: "معطّل",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${map[status] ?? "bg-zinc-100"}`}>
      {label[status] ?? status}
    </span>
  );
}

export default function KeysCard() {
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [provider, setProvider] = useState("kie");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => toast.error("تعذر تحميل المفاتيح"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return toast.error("أدخل المفتاح أولًا");
    setBusy(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), label: label.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "فشل إضافة المفتاح");
      } else {
        toast.success("تمت إضافة المفتاح — سيُجرَّب الأخير لأنه الأحدث إضافة");
        setApiKey("");
        setLabel("");
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(k: KeyItem) {
    const action = k.status === "disabled" ? "enable" : "disable";
    const res = await fetch(`/api/keys/${k.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) return toast.error("فشل تغيير الحالة");
    toast.success(action === "disable" ? "تم تعطيل المفتاح" : "تم تنشيط المفتاح");
    load();
  }

  async function remove(k: KeyItem) {
    if (!confirm(`حذف المفتاح ${k.maskedKey}؟ لا يمكن التراجع.`)) return;
    const res = await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("فشل الحذف");
    toast.success("تم حذف المفتاح");
    load();
  }

  return (
    <section className="bg-white rounded-2xl border shadow-sm p-5" aria-label="مدير المفاتيح">
      <h2 className="text-lg font-extrabold flex items-center gap-2">🔑 مدير المفاتيح</h2>
      <p className="text-xs text-zinc-500 mt-1 leading-5 bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800">
        أضف عدة مفاتيح لكل مزود — التجربة تسلسلية (أول مفتاح ثم التالي ثم التالي) مع تبديل فوري
        تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
      </p>

      {/* نموذج الإضافة */}
      <form onSubmit={addKey} className="mt-4 grid gap-2 sm:grid-cols-12">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="sm:col-span-3 h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm"
          aria-label="المزود"
        >
          <option value="kie">kie.ai</option>
          <option value="cometapi">CometAPI</option>
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="تسمية اختيارية (مثل: حساب رئيسي)"
          className="sm:col-span-4 h-10 rounded-lg border border-zinc-300 px-3 text-sm"
          aria-label="تسمية المفتاح"
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="الصق مفتاح API هنا…"
          className="sm:col-span-5 h-10 rounded-lg border border-zinc-300 px-3 text-sm font-mono"
          dir="ltr"
          type="text"
          autoComplete="off"
          aria-label="مفتاح API"
        />
        <button
          type="submit"
          disabled={busy}
          className="sm:col-span-12 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-50"
        >
          {busy ? "جارٍ الإضافة…" : "إضافة المفتاح"}
        </button>
      </form>

      {/* قائمة المفاتيح */}
      <div className="mt-4 max-h-96 overflow-y-auto grid gap-2">
        {keys.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-6">لا توجد مفاتيح بعد — أضف مفتاحًا واحدًا على الأقل لبدء التوليد.</p>
        )}
        {keys.map((k) => (
          <div key={k.id} className="rounded-xl border p-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{PROVIDER_LABEL[k.provider] ?? k.provider}</span>
                {k.label && <span className="text-zinc-500 text-xs">({k.label})</span>}
                <StatusBadge status={k.status} />
              </div>
              <code className="text-xs text-zinc-600 font-mono" dir="ltr">{k.maskedKey}</code>
              <div className="text-[11px] text-zinc-500 flex flex-wrap gap-x-3">
                <span>استخدام: {k.usageCount}</span>
                <span className="text-emerald-600">نجاح: {k.successCount}</span>
                <span className="text-red-600">فشل: {k.failCount}</span>
                {k.lastError && (
                  <span className="text-red-500 truncate max-w-full" title={k.lastError}>
                    آخر خطأ: {k.lastError.slice(0, 80)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => toggle(k)}
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold hover:bg-zinc-50"
              >
                {k.status === "disabled" ? "تنشيط" : "تعطيل"}
              </button>
              <button
                onClick={() => remove(k)}
                className="rounded-lg border border-red-200 text-red-600 px-2.5 py-1.5 text-xs font-bold hover:bg-red-50"
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
