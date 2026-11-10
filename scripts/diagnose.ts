// تشخيص: آخر المهام وأخطاء المحاولات بالتفصيل
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const db = createClient({ url: get("TURSO_DATABASE_URL"), authToken: get("TURSO_AUTH_TOKEN") });

const tasks = await db.execute(
  `SELECT id, type, status, provider, key_id, model, progress, error_message,
          attempts_json, params_json, result_urls_json, created_at, updated_at
   FROM tasks ORDER BY created_at DESC LIMIT 8`
);
console.log("عدد المهام الأخيرة:", tasks.rows.length);
for (const r of tasks.rows) {
  console.log("\n==========", r.id, "==========");
  console.log("type:", r.type, "| status:", r.status, "| provider:", r.provider, "| key:", r.key_id, "| model:", r.model);
  console.log("created:", r.created_at, "| updated:", r.updated_at, "| progress:", r.progress);
  console.log("error:", r.error_message);
  try { console.log("attempts:", JSON.stringify(JSON.parse(String(r.attempts_json ?? "[]")), null, 1).slice(0, 2000)); } catch { console.log("attempts(raw):", r.attempts_json); }
  try { console.log("params:", String(r.params_json).slice(0, 300)); } catch {}
  console.log("results:", r.result_urls_json);
}

const keys = await db.execute("SELECT id, provider, label, status, usage_count, success_count, fail_count, last_error, last_used_at FROM api_keys");
console.log("\n===== المفاتيح =====");
for (const k of keys.rows) {
  console.log(k.id, "|", k.provider, "|", k.status, "| used:", k.usage_count, "ok:", k.success_count, "fail:", k.fail_count);
  console.log("  last_error:", k.last_error);
  console.log("  last_used:", k.last_used_at);
}
