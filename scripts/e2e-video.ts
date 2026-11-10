// اختبار e2e لتوليد فيديو كامل: generate_video ثم get_task كل 10 ثوانٍ حتى الاكتمال
// الاستخدام: bun scripts/e2e-video.ts [wait_seconds]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_TEST_URL || "http://localhost:3000/mcp";
const WAIT = Number(process.argv[2] ?? 25);
const MAX_MINUTES = 15;

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
const client = new Client({ name: "e2e-video-client", version: "1.0.0" });
await client.connect(transport);

const res = await client.callTool(
  {
    name: "generate_video",
    arguments: {
      prompt: "A fluffy orange cat walks confidently across a sunny kitchen counter, looks directly at the camera and meows once.",
      duration: 6,
      resolution: "480p",
      wait_seconds: WAIT,
    },
  },
  undefined,
  { onprogress: (p) => console.error(`[progress] ${p.progress}/${p.total}`) }
);

const text = ((res.content ?? []) as { type: string; text: string }[]).map((c) => c.text).join("\n");
console.log("=== رد generate_video ===");
console.log(text);

// استخرج task_id إن أعاد مهمة قيد المعالجة
const m = text.match(/task_id:\s*([0-9a-f-]+)/i);
if (!m || res.isError) {
  console.error("لا مهمة للمتابعة أو خطأ — انتهى الاختبار");
  await client.close();
  process.exit(0);
}

const taskId = m[1];
console.log(`=== المتابعة بـ get_task كل 10 ثوانٍ حتى ${MAX_MINUTES} دقائق ===`);
const deadline = Date.now() + MAX_MINUTES * 60_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10_000));
  const r2 = await client.callTool({ name: "get_task", arguments: { task_id: taskId } });
  const t2 = ((r2.content ?? []) as { type: string; text: string }[]).map((c) => c.text).join("\n");
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${t2.split("\n")[0]}`);
  if (r2.isError || t2.includes("✅")) {
    console.log(t2);
    break;
  }
}
await client.close();
