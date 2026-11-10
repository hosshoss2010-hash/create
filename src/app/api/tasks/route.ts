// قائمة المهام للوحة الإدارة: أحدث المهام + الإحصائيات
import { NextResponse } from "next/server";
import { ensureSchema, listRecentTasks, taskStats } from "@/lib/turso";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const type = url.searchParams.get("type") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const [tasks, stats] = await Promise.all([
    listRecentTasks(Number.isFinite(limit) ? limit : 20, { type, status }),
    taskStats(),
  ]);

  return NextResponse.json({
    stats,
    tasks: tasks.map((t) => ({
      id: t.id,
      type: t.type,
      model: t.model,
      provider: t.provider,
      prompt: t.prompt.slice(0, 200),
      status: t.status,
      progress: t.progress,
      resultUrls: t.resultUrls,
      errorMessage: t.errorMessage,
      attemptsCount: t.attempts.length,
      lastAttempt: t.attempts.length
        ? {
            provider: t.attempts[t.attempts.length - 1].provider,
            ok: t.attempts[t.attempts.length - 1].ok,
            errorClass: t.attempts[t.attempts.length - 1].errorClass,
            at: t.attempts[t.attempts.length - 1].at,
          }
        : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt,
    })),
  });
}
