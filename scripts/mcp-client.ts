// عميل MCP حقيقي (SDK الرسمي) للاختبار الشامل — يُشغَّل بـ: bun scripts/mcp-client.ts <command>
// أوامر: list | call <tool> [json-args] | raw
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_TEST_URL || "http://localhost:3000/mcp";
const [, , cmd = "list", tool, argsJson] = process.argv;

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
const client = new Client({ name: "e2e-test-client", version: "1.0.0" });
await client.connect(transport);
console.error(`متصل بـ ${MCP_URL} ✓`);

if (cmd === "list") {
  const { tools } = await client.listTools();
  console.log("الأدوات المسجلة:", tools.map((t) => t.name).join(", "));
  for (const t of tools) {
    console.log(`\n=== ${t.name} ===`);
    console.log("description:", t.description?.slice(0, 120) + "…");
    console.log("schema:", JSON.stringify(t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : t.inputSchema));
  }
} else if (cmd === "call") {
  const args = argsJson ? JSON.parse(argsJson) : {};
  const res = await client.callTool(
    { name: tool, arguments: args },
    undefined,
    // استقبال إشعارات التقدم الحي — دليل على بث Progress notifications
    { onprogress: (p) => console.error(`[progress] ${p.progress}/${p.total} — ${(p as { message?: string }).message ?? ""}`) }
  );
  console.log("isError:", res.isError === true);
  for (const c of (res.content ?? []) as { type: string; text: string }[]) {
    if (c.type === "text") console.log(c.text);
  }
} else if (cmd === "raw") {
  // استدعاء بمعطيات خام من stdin
  const input = JSON.parse(await Bun.stdin.text());
  const res = await client.callTool(input, undefined, {
    onprogress: (p) => console.error(`[progress] ${p.progress}/${p.total}`),
  });
  console.log("isError:", res.isError === true);
  for (const c of (res.content ?? []) as { type: string; text: string }[]) {
    if (c.type === "text") console.log(c.text);
  }
}

await client.close();
