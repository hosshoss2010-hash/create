// اختبار سريع لاتصال Turso وإنشاء المخطط — يُحذف بعد التحقق
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL!;
const token = process.env.TURSO_AUTH_TOKEN!;
if (!url || !token) { console.error("MISSING ENV"); process.exit(1); }

const db = createClient({ url, authToken: token });
const r = await db.execute("SELECT 1 AS one");
console.log("SELECT 1 →", JSON.stringify(r.rows));
await db.execute(`CREATE TABLE IF NOT EXISTS _conn_test (id TEXT PRIMARY KEY)`);
await db.execute(`DROP TABLE _conn_test`);
console.log("TURSO CONNECTED ✓ —", url.split("//")[1]);
