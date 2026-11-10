// ============================================================
// سجل الموديلات — الأسماء الموحدة (canonical) وصيغ المزودين
// الأسماء قابلة للتجاوز بمتغيرات البيئة، ونقبل الصيغ البديلة بالنقاط ونوحدّها.
// ملاحظة: أسماء CometAPI مأخوذة من توثيقها الرسمي المقاس (الفيديو: grok-imagine-video-1.5)
// ============================================================

export type ProviderId = "kie" | "cometapi";
export type TaskProvider = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string; // الاسم كما يراه عميل MCP
  aliases: string[]; // صيغ بديلة نقبلها ونوحدّها (شرطات/نقاط)
  type: MediaType;
  providers: ProviderId[]; // من يستطيع خدمته — تُجرَّب مفاتيحهم كلها بالترتيب
  providerModel: Record<ProviderId, string>; // اسم الموديل كما يُرسل لكل مزود
}

const KIE_IMAGE =
  process.env.KIE_IMAGE_MODEL?.trim() || "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO =
  process.env.KIE_VIDEO_MODEL?.trim() || "grok-imagine-video-1-5-preview";
const COMETAPI_IMAGE =
  process.env.COMETAPI_IMAGE_MODEL?.trim() || "gpt-image-2.6-flare-text-to-image";
const COMETAPI_VIDEO =
  process.env.COMETAPI_VIDEO_MODEL?.trim() || "grok-imagine-video-1.5";

export const MODELS: ModelDef[] = [
  {
    canonical: "gpt-image-2-6/flare-text-to-image",
    aliases: ["gpt-image-2.6/flare-text-to-image"],
    type: "image",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_IMAGE, cometapi: COMETAPI_IMAGE },
  },
  {
    canonical: "grok-imagine-video-1-5-preview",
    aliases: ["grok-imagine-video-1.5-preview"],
    type: "video",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_VIDEO, cometapi: COMETAPI_VIDEO },
  },
];

/** توحيد الصيغ: صغيرة + النقاط إلى شرطات (2.6→2-6، 1.5→1-5) */
export function normalizeModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/2\.6/g, "2-6")
    .replace(/1\.5/g, "1-5");
}

export function findModel(
  name: string | undefined,
  type: MediaType
): ModelDef | undefined {
  if (!name) return MODELS.find((m) => m.type === type);
  const n = normalizeModelName(name);
  return MODELS.find(
    (m) =>
      m.type === type &&
      (normalizeModelName(m.canonical) === n ||
        m.aliases.some((a) => normalizeModelName(a) === n))
  );
}

export function availableModelNames(): string[] {
  return MODELS.map((m) => m.canonical);
}

/** قائمة مختصرة لعرضها في /api/health */
export function listModelsForHealth() {
  return MODELS.map((m) => ({
    canonical: m.canonical,
    type: m.type,
    providers: m.providers,
  }));
}
