// إدارة المفاتيح — القائمة والإضافة
// القاعدة الذهبية 9: المفاتيح تُخفى دائمًا (maskKey) ولا يُعاد المفتاح الكامل مطلقًا.
import { NextResponse } from "next/server";
import { ensureSchema, listKeys, insertKey, findKeyBySecret, type KeyRow } from "@/lib/turso";
import { maskKey } from "@/lib/keys";

export const runtime = "nodejs";

const PROVIDERS = ["kie", "cometapi"];

function publicView(k: KeyRow) {
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    maskedKey: maskKey(k.apiKey),
    status: k.status,
    usageCount: k.usageCount,
    successCount: k.successCount,
    failCount: k.failCount,
    lastUsedAt: k.lastUsedAt,
    lastCheckedAt: k.lastCheckedAt,
    lastError: k.lastError,
    createdAt: k.createdAt,
  };
}

export async function GET() {
  await ensureSchema();
  const keys = await listKeys();
  return NextResponse.json({ keys: keys.map(publicView) });
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    api_key?: string;
    label?: string;
  };
  const provider = String(body.provider || "").trim();
  const apiKey = String(body.api_key || "").trim();
  const label = String(body.label || "").trim().slice(0, 100);

  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "المزود غير صالح — المسموح: kie أو cometapi" }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: "المفتاح مطلوب" }, { status: 400 });
  }
  const dup = await findKeyBySecret(provider, apiKey);
  if (dup) {
    return NextResponse.json({ error: "هذا المفتاح مُضاف مسبقًا لنفس المزود" }, { status: 409 });
  }
  const k = await insertKey({ provider, apiKey, label });
  return NextResponse.json({ key: publicView(k) }, { status: 201 });
}
