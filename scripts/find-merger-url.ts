// البحث عن أي أثر لعنوان خدمة الدمج في قاعدة البيانات (مهام دمج قديمة أو أخطاء)
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";

// اقرأ المتغيرات من .env.local يدويًا
const env = readFileSync(".env.local", "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const url = get("TURSO_DATABASE_URL");
const token = get("TURSO_AUTH_TOKEN");

const db = createClient({ url, authToken: token });

// 1) هل جدول tasks موجود وبه صفوف؟
const tasks = await db.execute("SELECT id, type, status, provider, provider_task_id, result_urls_json, error_message, created_at FROM tasks ORDER BY created_at DESC LIMIT 50");
console.log("عدد المهام:", tasks.rows.length);
for (const r of tasks.rows) {
  console.log("-", r.type, "|", r.status, "|", r.provider, "|", r.provider_task_id, "|", r.result_urls_json, "|", r.error_message);
}

// 2) استخرج كل النطاقات من أي روابط في النتائج
const domains = new Set<string>();
for (const r of tasks.rows) {
  const s = String(r.result_urls_json ?? "");
  for (const m of s.matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)) domains.add(m[0]);
}
console.log("النطاقات في الروابط:", [...domains]);

// 3) المفاتيح الحالية (مقنّعة)
const keys = await db.execute("SELECT provider, label, status, usage_count FROM api_keys");
console.log("المفاتيح:", JSON.stringify(keys.rows));
