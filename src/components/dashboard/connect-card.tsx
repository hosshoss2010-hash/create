"use client";

// بطاقة ربط السيرفر: رابط MCP + إعدادات جاهزة للنسخ لكل عميل + رقائق الأدوات
import { useMemo } from "react";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TOOLS = [
  { name: "generate_image", desc: "توليد صورة من وصف نصي (تبديل تلقائي عبر كل المفاتيح)" },
  { name: "generate_video", desc: "توليد فيديو بصوت متزامن أصلي + صورة-إلى-فيديو اختيارية" },
  { name: "merge_videos", desc: "دمج عدة مقاطع في فيديو واحد بالترتيب المطلوب (حد 10)" },
  { name: "get_task", desc: "متابعة أي مهمة بمعرّفها وتحديثها حيًا من المزود" },
  { name: "list_media", desc: "استرجاع أحدث الوسائط المخزنة بروابطها دون إعادة توليد" },
];

function CopyButton({ text, label = "نسخ" }: { text: string; label?: string }) {
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("تم النسخ");
        } catch {
          toast.error("تعذر النسخ — انسخ يدويًا");
        }
      }}
      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-bold hover:bg-zinc-50"
    >
      {label}
    </button>
  );
}

function JsonBlock({ json }: { json: string }) {
  return (
    <pre
      dir="ltr"
      className="mt-2 rounded-xl bg-zinc-950 text-emerald-300 text-xs p-3 overflow-x-auto font-mono leading-6"
    >
      {json}
    </pre>
  );
}

export default function ConnectCard({ authRequired }: { authRequired: boolean }) {
  // أصل النافذة (آمن للترطيب: "" على الخادم ثم الرابط الحقيقي على العميل)
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );

  const mcpUrl = `${origin}/mcp`;

  const headers = useMemo(
    () =>
      authRequired
        ? `\n      "headers": {\n        "Authorization": "Bearer <ضع هنا قيمة MCP_ACCESS_TOKEN>"\n      }`
        : "",
    [authRequired]
  );

  const chatgptJson = `{\n  "mcpServers": {\n    "media-generator": {\n      "url": "${mcpUrl}"${headers}\n    }\n  }\n}`;
  const claudeJson = `{\n  "mcpServers": {\n    "media-generator": {\n      "type": "http",\n      "url": "${mcpUrl}"${headers}\n    }\n  }\n}`;
  const cursorJson = `{\n  "mcpServers": {\n    "media-generator": {\n      "url": "${mcpUrl}"${headers}\n    }\n  }\n}`;

  return (
    <section className="bg-white rounded-2xl border shadow-sm p-5" aria-label="ربط السيرفر">
      <h2 className="text-lg font-extrabold flex items-center gap-2">🔌 ربط السيرفر</h2>

      {/* رابط MCP */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={mcpUrl}
          dir="ltr"
          className="flex-1 min-w-64 h-10 rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-sm font-mono"
          aria-label="رابط MCP"
        />
        <CopyButton text={mcpUrl} label="نسخ الرابط" />
      </div>
      {authRequired && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          الخادم محمي بـ MCP_ACCESS_TOKEN — أضف ترويسة <code dir="ltr">Authorization: Bearer &lt;token&gt;</code> في إعدادات العميل.
        </p>
      )}

      {/* تبويبات العملاء */}
      <Tabs defaultValue="chatgpt" className="mt-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="chatgpt" className="text-xs">ChatGPT / GPT Agents</TabsTrigger>
          <TabsTrigger value="claude" className="text-xs">Claude Desktop</TabsTrigger>
          <TabsTrigger value="cursor" className="text-xs">Cursor / Cline</TabsTrigger>
        </TabsList>

        <TabsContent value="chatgpt">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">في ChatGPT: Settings ← Connectors ← Create ← Custom MCP server، وضع الرابط في «Server URL».</p>
            <CopyButton text={chatgptJson} />
          </div>
          <JsonBlock json={chatgptJson} />
        </TabsContent>

        <TabsContent value="claude">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">أضفه إلى ملف <code dir="ltr">claude_desktop_config.json</code> ثم أعد تشغيل Claude Desktop.</p>
            <CopyButton text={claudeJson} />
          </div>
          <JsonBlock json={claudeJson} />
        </TabsContent>

        <TabsContent value="cursor">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">يصلح لملف <code dir="ltr">mcp.json</code> في Cursor و Windsurf و Cline.</p>
            <CopyButton text={cursorJson} />
          </div>
          <JsonBlock json={cursorJson} />
        </TabsContent>
      </Tabs>

      {/* رقائق الأدوات الخمس */}
      <h3 className="mt-5 text-sm font-extrabold text-zinc-700">الأدوات الخمس المتاحة</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <div
            key={t.name}
            className="rounded-xl border bg-zinc-50 px-3 py-2 max-w-full"
          >
            <code className="text-xs font-mono font-bold text-emerald-700" dir="ltr">{t.name}</code>
            <p className="text-[11px] text-zinc-500 mt-0.5">{t.desc}</p>
          </div>
        ))}
      </div>

      {/* ملاحظة كهرمانية عن الفيديو والتقدم الحي */}
      <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-6">
        ⚠️ الفيديو يحتاج دقائق: يعيد السيرفر <code dir="ltr">task_id</code> فورًا، ويتابَع تلقائيًا بـ{" "}
        <code dir="ltr">get_task</code> كل 10 ثوانٍ — وعند اكتمال المهمة يُعرض الرابط في الدردشة ويتوقف.
        أثناء الانتظار يُبَث تقدم حي (Progress notifications) حتى لا تنقطع العملية.
      </div>
    </section>
  );
}
