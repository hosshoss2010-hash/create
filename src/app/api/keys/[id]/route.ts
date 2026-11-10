// تعطيل/تنشيط/حذف مفتاح — التحكم اليدوي من الواجهة
import { NextResponse } from "next/server";
import { ensureSchema, getKeyById, deleteKey } from "@/lib/turso";
import { markKeyStatus, maskKey } from "@/lib/keys";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const key = await getKeyById(id);
  if (!key) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });

  if (body.action === "disable") {
    await markKeyStatus(id, "disabled", "تعطيل يدوي من الواجهة");
  } else if (body.action === "enable") {
    // التنشيط اليدوي يعيد المفتاح المستنزف/المعطل للخدمة (بعد شحن الرصيد مثلًا)
    await markKeyStatus(id, "active");
  } else {
    return NextResponse.json({ error: "الإجراء غير معروف — المسموح: disable أو enable" }, { status: 400 });
  }
  const updated = await getKeyById(id);
  return NextResponse.json({
    key: updated
      ? {
          id: updated.id,
          provider: updated.provider,
          label: updated.label,
          maskedKey: maskKey(updated.apiKey),
          status: updated.status,
          usageCount: updated.usageCount,
          successCount: updated.successCount,
          failCount: updated.failCount,
          lastUsedAt: updated.lastUsedAt,
          lastCheckedAt: updated.lastCheckedAt,
          lastError: updated.lastError,
          createdAt: updated.createdAt,
        }
      : null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  const key = await getKeyById(id);
  if (!key) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });
  await deleteKey(id);
  return NextResponse.json({ ok: true });
}
