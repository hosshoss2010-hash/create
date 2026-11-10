// تنظيف آثار الاختبار: حذف مهام الاختبار + المفتاح الوهمي + تصفير عدّادات المفتاح الحقيقي
import { getDb, ensureSchema } from "../src/lib/turso";

await ensureSchema();

// 1) حذف كل مهام الاختبار
const t = await getDb().execute("DELETE FROM tasks");
console.log("حُذفت المهام:", t.rowsAffected);

// 2) حذف المفتاح الوهمي (اختبار 401)
const k = await getDb().execute(
  `DELETE FROM api_keys WHERE api_key = 'invalid-test-key-000-abcdef123456'`
);
console.log("حُذف المفتاح الوهمي:", k.rowsAffected);

// 3) تصفير عدّادات المفتاح الحقيقي لبداية نظيفة
const r = await getDb().execute(
  `UPDATE api_keys SET usage_count = 0, success_count = 0, fail_count = 0, last_error = NULL, last_used_at = NULL, last_checked_at = NULL`
);
console.log("صُفّرت العدّادات:", r.rowsAffected);

const left = await getDb().execute("SELECT provider, label, status FROM api_keys");
console.log("المفاتيح المتبقية:", JSON.stringify(left.rows));
