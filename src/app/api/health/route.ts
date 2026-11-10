// فحص الصحة العام: قاعدة البيانات + خدمة الدمج + قائمة الموديلات
// يتضمن تشخيصًا دقيقًا لاتصال Turso (بادئة الرابط فقط — لا أسرار)
import { NextResponse } from "next/server";
import { ensureSchema, diagnoseDb, type DbDiagnosis } from "@/lib/turso";
import { listModelsForHealth } from "@/lib/models";
import { checkMergerHealth } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_DIAG: DbDiagnosis = {
  urlSet: false,
  urlPrefix: "",
  tokenSet: false,
  tokenLength: 0,
  connected: false,
  error: "فشل إجراء التشخيص",
};

export async function GET() {
  let turso: DbDiagnosis = EMPTY_DIAG;
  try {
    turso = await diagnoseDb();
    if (turso.connected) {
      // أنشئ المخطط عند أول فحص صحي (بلا أخطاء يكسر الرد)
      await ensureSchema().catch(() => {});
    }
  } catch {
    turso = EMPTY_DIAG;
  }

  const mergerBase = (process.env.MERGER_API_BASE || "").trim();
  const mergerHealthy = mergerBase ? await checkMergerHealth() : false;

  return NextResponse.json(
    {
      ok: turso.connected,
      database: turso.connected ? "turso-connected" : "turso-disconnected",
      turso: turso,
      mcpEndpoint: "/mcp",
      models: listModelsForHealth(),
      merger: { base: mergerBase, healthy: mergerHealthy },
      authRequired: Boolean(process.env.MCP_ACCESS_TOKEN?.trim()),
    },
    { status: 200 }
  );
}
