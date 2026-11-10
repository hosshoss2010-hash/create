// ============================================================
// مزود CometAPI (المزود الثاني):
// - الصور: نقطة OpenAI-compatible متزامنة POST /v1/images/generations
//   (موديلات gpt-image تعيد b64_json بلا رابط — والقاعدة الذهبية "روابط فقط"
//    تعني أننا لا نستضيف وسائط، لذا نعامل غياب الرابط كقصور لدى المزود
//    ونتقل للمفتاح/المزود التالي تلقائيًا).
// - الفيديو: نقطة xAI-style غير متزامنة POST /grok/v1/videos/generations
//   ثم GET /grok/v1/videos/{request_id} (أشكال من التوثيق الرسمي apidoc.cometapi.com).
// ============================================================
import { ProviderError, type ProviderAdapter } from "./types";

const BASE = process.env.COMETAPI_BASE?.trim() || "https://api.cometapi.com";

 
function errMessage(body: any, fallback: string): string {
  return (
    body?.error?.message ||
    body?.error ||
    body?.message ||
    body?.msg ||
    fallback
  );
}

async function safeFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ProviderError(undefined, `network: ${e instanceof Error ? e.message : "fetch failed"}`);
  }
}

export const cometapiAdapter: ProviderAdapter = {
  buildInput(type, args) {
    const a = args as {
      prompt?: string;
      aspect_ratio?: string;
      resolution?: string;
      output_format?: string;
      duration?: number;
      image_url?: string;
    };
    if (type === "image") {
      const input: Record<string, unknown> = { prompt: a.prompt ?? "", n: 1 };
      if (a.output_format && a.output_format !== "png") input.output_format = a.output_format;
      return input;
    }
    const input: Record<string, unknown> = {
      prompt: a.prompt ?? "",
      duration: typeof a.duration === "number" ? a.duration : 8,
    };
    if (a.aspect_ratio && a.aspect_ratio !== "auto") input.aspect_ratio = a.aspect_ratio;
    if (a.resolution) input.resolution = a.resolution;
    if (a.image_url) input.image = { url: a.image_url }; // image-to-video وفق توثيق xAI على CometAPI
    return input;
  },

  async createImageSync(key, providerModel, input) {
    const res = await safeFetch(
      `${BASE}/v1/images/generations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: providerModel, ...input }),
      },
      120_000 // توليد الصور المتزامن قد يأخذ وقتًا
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(res.status, errMessage(body, `HTTP ${res.status}`));
     
    const d0 = (body as { data?: any[] }).data?.[0];
    if (d0?.url && typeof d0.url === "string") return { urls: [d0.url] };
    // b64_json فقط (سلوك موديلات gpt-image لدى CometAPI) → لا رابط مباشر → قصور مزود
    // (الرسالة تحتوي "unsupported model" لضمان التصنيف provider والانتقال للمفتاح التالي)
    throw new ProviderError(
      400,
      "unsupported model output: no direct URL returned (b64_json only)"
    );
  },

  async createTask(key, providerModel, input) {
    const res = await safeFetch(
      `${BASE}/grok/v1/videos/generations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: providerModel, ...input }),
      },
      30_000
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(res.status, errMessage(body, `HTTP ${res.status}`));
    const id =
      body?.request_id ?? body?.id ?? body?.task_id ?? body?.data?.task_id ?? body?.data?.request_id;
    if (!id) throw new ProviderError(res.status, "استجابة إنشاء الفيديو بلا معرّف مهمة");
    return { providerTaskId: String(id) };
  },

  async checkTask(key, providerTaskId) {
    const res = await safeFetch(
      `${BASE}/grok/v1/videos/${encodeURIComponent(providerTaskId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
      20_000
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(res.status, errMessage(body, `HTTP ${res.status}`));
    const status = String(body?.status ?? "").toLowerCase();

    // دفاعي: اكتمل | فشل | غير ذلك = قيد المعالجة
    if (["done", "completed", "complete", "success", "succeeded", "finished"].includes(status)) {
      const urls: string[] = [];
      const v = body?.video?.url ?? body?.video_url ?? body?.data?.video?.url;
      if (typeof v === "string" && v) urls.push(v);
      if (Array.isArray(body?.output)) {
        for (const o of body.output) {
          const u = typeof o === "string" ? o : o?.url;
          if (typeof u === "string" && u) urls.push(u);
        }
      }
      return { status: "completed", urls };
    }
    if (["failed", "error", "cancelled", "canceled", "expired"].includes(status)) {
      return { status: "failed", error: errMessage(body, `فشل المزود (${status || "unknown"})`) };
    }
    return { status: "processing" };
  },
};
