// فحص الصحة العام: قاعدة البيانات + خدمة الدمج + قائمة الموديلات
import { NextResponse } from "next/server";
import { dbHealthy, ensureSchema } from "@/lib/turso";
import { listModelsForHealth } from "@/lib/models";
import { checkMergerHealth } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    await ensureSchema();
    dbOk = await dbHealthy();
  } catch {
    dbOk = false;
  }

  const mergerBase = (process.env.MERGER_API_BASE || "").trim();
  const mergerHealthy = mergerBase ? await checkMergerHealth() : false;

  return NextResponse.json(
    {
      ok: dbOk,
      database: dbOk ? "turso-connected" : "turso-disconnected",
      mcpEndpoint: "/mcp",
      models: listModelsForHealth(),
      merger: { base: mergerBase, healthy: mergerHealthy },
      authRequired: Boolean(process.env.MCP_ACCESS_TOKEN?.trim()),
    },
    { status: 200 }
  );
}
