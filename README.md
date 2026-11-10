# 🎬 MCP Media Generator

**خادم MCP لتوليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع — مع لوحة إدارة عربية RTL**

خادم واحد يجمع ثلاث قدرات في أداة واحدة:

1. **توليد صور** من وصف نصي — الموديل المدمج: `gpt-image-2-6/flare-text-to-image`
2. **توليد فيديو** مع صوت متزامن أصلي (حوار/مؤثرات/موسيقى) — الموديل المدمج: `grok-imagine-video-1-5-preview`
3. **دمج عدة مقاطع فيديو** في مقطع واحد عالي الجودة وبالترتيب المطلوب

---

## ⚙️ القواعد الجوهرية

- **روابط فقط**: لا يُنزَّل أي ملف وسائط على السيرفر إطلاقًا — تُخزَّن روابط النتائج في قاعدة البيانات فقط.
- **مفاتيح تسلسلية صارمة**: أول مفتاح أُضيف يُجرَّب أولًا ثم التالي ثم التالي (حسب `created_at ASC`) — ليس round-robin.
- **تبديل فوري لا يتوقف**: عند أي خطأ أو نفاد رصيد تُستأنف نفس المهمة بنفس `task_id` على المفتاح التالي، ونموذج الذكاء الاصطناعي **لا يرى أخطاء المفاتيح أو الرصيد أبدًا**.
- **بلا يأس**: مهمة فشلت على كل المفاتيح تبقى `processing` (بانتظار توفر مفتاح صالح…) وتُعاد محاولتها تلقائيًا مع كل استدعاء `get_task` بعد تهدئة ~45 ثانية — شحن أي مفتاح يكمل المهام المعلقة تلقائيًا.
- **إخفاء المفاتيح إلزامي**: `ABCD123••••••••WXYZ` في كل الاستجابات والسجلات.
- **دمج حتمي**: أي خطأ HTTP معلن من خدمة الدمج = فشل نهائي فوري؛ أخطاء شبكتنا مؤقتة وتستمر بالاستعلام. ملفات الدمج تُحذف من الخدمة بعد ~24 ساعة.

## 🧰 الأدوات الخمس على `/mcp`

| الأداة | الوظيفة |
|---|---|
| `generate_image` | توليد صورة من وصف نصي (نافذة انتظار افتراضية 90 ثانية مع بث تقدم حي) |
| `generate_video` | توليد فيديو بصوت متزامن + image-to-video اختياري (نافذة افتراضية 25 ثانية ثم `task_id`) |
| `merge_videos` | دمج 2–10 مقاطع عبر `urls` مباشرة أو `task_ids` لمهام مكتملة (بالترتيب) |
| `get_task` | متابعة أي مهمة وتحديثها حيًا من المزود/خدمة الدمج |
| `list_media` | استرجاع أحدث الوسائط المخزنة بروابطها |

التقدّم الحي: كل ~3 ثوانٍ تُبث إشعارات `notifications/progress` (عند تزويد `_meta.progressToken`).

## 🚀 التشغيل المحلي

```bash
bun install
cp .env.example .env.local   # ثم املأ القيم
bun run dev                  # http://localhost:3000
```

- الواجهة: `http://localhost:3000`
- خادم MCP: `http://localhost:3000/mcp`
- فحص الصحة: `http://localhost:3000/api/health`

## 🗄️ قاعدة البيانات (Turso مجاني)

```bash
turso db create <name>
turso db show <name> --url          # → TURSO_DATABASE_URL
turso db tokens create <name>       # → TURSO_AUTH_TOKEN
```

المخطط يُنشأ تلقائيًا عند أول وصول (`CREATE TABLE IF NOT EXISTS`) — لا حاجة لأي migrations. الاتصال عبر HTTP (`@libsql/client`) فلا توجد أي ملفات محلية، وهو مناسب تمامًا لبيئات serverless.

## 🔐 متغيرات البيئة

| المتغير | إلزامي | الوصف |
|---|---|---|
| `TURSO_DATABASE_URL` | ✅ | رابط قاعدة Turso |
| `TURSO_AUTH_TOKEN` | ✅ | توكن بصلاحيات كتابة |
| `MERGER_API_BASE` | للدمج | عنوان خدمة Video Merger API v2 |
| `MCP_ACCESS_TOKEN` | — | إن ضُبط يُطلب `Authorization: Bearer <token>` على `/mcp` |
| `KIE_IMAGE_MODEL` / `KIE_VIDEO_MODEL` | — | تجاوز أسماء موديلات kie.ai |
| `COMETAPI_IMAGE_MODEL` / `COMETAPI_VIDEO_MODEL` | — | تجاوز أسماء موديلات CometAPI |

> **مهم**: ملفات `.env*` مستثناة من Git منذ أول commit — لا ترفع أي سرّ أبدًا.

## ☁️ النشر على Vercel

1. اربط المستودع في Vercel.
2. أضف المتغيرات الثلاثة (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `MERGER_API_BASE`) في Settings → Environment Variables.
3. Deploy — كل شيء يعمل لأن libSQL يتصل عبر HTTP ومسار `/mcp` يدعم الـ streaming، ولا اعتماد على أي ملف محلي.

## 🔌 ربط العملاء

**ChatGPT / GPT Agents** — Settings → Connectors → Create → Custom MCP server، وضع `https://<نطاقك>/mcp` في «Server URL»:

```json
{ "mcpServers": { "media-generator": { "url": "https://<نطاقك>/mcp" } } }
```

**Claude Desktop** — في `claude_desktop_config.json`:

```json
{ "mcpServers": { "media-generator": { "type": "http", "url": "https://<نطاقك>/mcp" } } }
```

**Cursor / Windsurf / Cline** — في `mcp.json` بنفس صيغة ChatGPT أعلاه.

> الخادم يعمل بوضع عديم الجلسة (stateless) عبر Streamable HTTP — لا حاجة لأي session-id.

## 🏗️ البنية

```
src/
├── app/
│   ├── mcp/route.ts              # خادم MCP (Streamable HTTP، SDK رسمي)
│   ├── api/health/route.ts       # فحص الصحة (Turso + الدمج + الموديلات)
│   ├── api/keys/route.ts         # قائمة/إضافة مفاتيح (مقنّعة دائمًا)
│   ├── api/keys/[id]/route.ts    # تعطيل/تنشيط/حذف
│   ├── api/tasks/route.ts        # أحدث المهام + الإحصائيات
│   └── page.tsx                  # لوحة الإدارة العربية RTL
├── components/dashboard/         # مدير المفاتيح + لوحة المهام + ربط السيرفر
└── lib/
    ├── turso.ts                  # طبقة القاعدة (المخطط + عمليات المهام والمفاتيح)
    ├── keys.ts                   # الترتيب التسلسلي + classifyProviderError + maskKey
    ├── models.ts                 # سجل الموديلات (canonical/aliases/providerModel)
    ├── providers/
    │   ├── kie.ts                # Jobs API الموحد (resultJson نص JSON داخل JSON)
    │   └── cometapi.ts           # صور متزامنة + فيديو xAI-style غير متزامن
    ├── generation.ts             # runGeneration/refreshTask بمنطق التبديل «لا توقف أبدًا»
    ├── merger.ts                 # عميل Video Merger API v2 (process مرة واحدة بقفل)
    ├── replies.ts                # صياغة الردود العربية + تنقية أخطاء المفاتيح
    └── mcp-server.ts             # تسجيل الأدوات الخمس
```

## 🧪 سكربتات الاختبار

```bash
bun scripts/mcp-client.ts list                                # قائمة الأدوات
bun scripts/mcp-client.ts call generate_image '{"prompt":"..."}'
bun scripts/e2e-video.ts                                     # فيديو كامل + متابعة get_task
bun scripts/cleanup.ts                                       # تنظيف بيانات الاختبار
```

## ⚠️ ملاحظات

- موديلات CometAPI الافتراضية مأخوذة من توثيقها الرسمي (`grok-imagine-video-1.5` للفيديو) وقابلة للتجاوز بمتغيرات البيئة؛ موديلات gpt-image لديهم تعيد `b64_json` بلا رابط مباشر — وحكمًا بقاعدة «روابط فقط» يُنتقل تلقائيًا للمفتاح/المزود التالي.
- خدمة الدمج تُضبط بـ `MERGER_API_BASE` فقط (بلا مفاتيح): 10 مقاطع كحد أقصى، 200MB لكل مصدر، 150MB للناتج، والمخرج MP4 ثابت الإعدادات.
