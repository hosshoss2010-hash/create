// ============================================================
// مزود kie.ai — Jobs API الموحد (الأشكال مقاسة فعليًا بنداءات حقيقية):
//   POST /api/v1/jobs/createTask  → {code:200, data:{taskId}}
//   GET  /api/v1/jobs/recordInfo  → {data:{state, resultJson(نص JSON!), failMsg}}
// ملاحظة مهمة: resultJson نص JSON داخل JSON ويحتاج JSON.parse ثانيًا.
// ============================================================
import { ProviderError, type ProviderAdapter } from "./types";

const BASE = "https://api.kie.ai";

function asProviderError(status: number, body: unknown, fallback: string): ProviderError {
  const b = (body ?? {}) as { msg?: string; message?: string; error?: { message?: string } };
  const msg = b.msg || b.message || b.error?.message || fallback;
  return new ProviderError(status, msg);
}

async function safeFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // انقطاع شبكة/timeout لدينا — يُصنَّف temporary تلقائيًا (status=undefined)
    throw new ProviderError(undefined, `network: ${e instanceof Error ? e.message : "fetch failed"}`);
  }
}

export const kieAdapter: ProviderAdapter = {
  buildInput(type, args) {
    const a = args as {
      prompt?: string;
      aspect_ratio?: string;
      resolution?: string;
      background?: string;
      output_format?: string;
      duration?: number;
      image_url?: string;
    };
    if (type === "image") {
      const input: Record<string, unknown> = { prompt: a.prompt ?? "" };
      if (a.aspect_ratio && a.aspect_ratio !== "auto") input.aspect_ratio = a.aspect_ratio;
      if (a.resolution) input.resolution = a.resolution;
      // نمرر background/output_format فقط عند غير الافتراضي لتقليل احتمال رفض المعطيات
      if (a.background && a.background !== "auto") input.background = a.background;
      if (a.output_format && a.output_format !== "png") input.output_format = a.output_format;
      return input;
    }
    const input: Record<string, unknown> = { prompt: a.prompt ?? "" };
    if (a.aspect_ratio && a.aspect_ratio !== "auto") input.aspect_ratio = a.aspect_ratio;
    if (a.resolution) input.resolution = a.resolution;
    if (typeof a.duration === "number") input.duration = a.duration;
    // enable_audio لا يُرسل: الصوت الأصلي متزامن دائمًا في هذا الموديل (لا يمكن إطفاؤه وفق التوثيق)
    if (a.image_url) input.image_urls = [a.image_url]; // image-to-video: الإطار الأول
    return input;
  },

  async createTask(key, providerModel, input) {
    const res = await safeFetch(
      `${BASE}/api/v1/jobs/createTask`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: providerModel, input }),
      },
      30_000
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body as { code?: number }).code !== 200) {
      throw asProviderError(res.status, body, `HTTP ${res.status}`);
    }
    const taskId = (body as { data?: { taskId?: string } }).data?.taskId;
    if (!taskId) throw new ProviderError(res.status, "استجابة createTask بلا taskId");
    return { providerTaskId: String(taskId) };
  },

  async checkTask(key, providerTaskId) {
    const res = await safeFetch(
      `${BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
      20_000
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body as { code?: number }).code !== 200) {
      throw asProviderError(res.status, body, `HTTP ${res.status}`);
    }
     
    const d = ((body as { data?: any }).data ?? {}) as {
      state?: string;
      resultJson?: string;
      failMsg?: string | null;
      failCode?: string | null;
      response?: { resultUrls?: string[] };
    };
    const state = String(d.state ?? "").toLowerCase();

    if (state === "success") {
      // resultJson نص JSON يحتاج JSON.parse ثانيًا (الشكل الحقيقي المقاس)
      let urls: string[] = [];
      try {
        const inner: unknown = typeof d.resultJson === "string" ? JSON.parse(d.resultJson) : d.resultJson;
        const ru = (inner as { resultUrls?: unknown })?.resultUrls;
        if (Array.isArray(ru)) urls = ru.map(String).filter(Boolean);
      } catch {
        /* تجاهل — نجرب الاحتياط أدناه */
      }
      if (!urls.length && Array.isArray(d.response?.resultUrls)) {
        urls = d.response.resultUrls.map(String).filter(Boolean);
      }
      return { status: "completed", urls };
    }
    if (state === "fail") {
      return { status: "failed", error: d.failMsg || d.failCode || "فشل التوليد لدى المزود" };
    }
    // waiting | queuing | generating → قيد المعالجة (التقدّم يُقدَّر زمنيًا في المنسّق)
    return { status: "processing" };
  },
};
