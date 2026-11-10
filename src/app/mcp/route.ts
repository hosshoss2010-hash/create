// ============================================================
// مسار /mcp — خادم MCP عبر Streamable HTTP (SDK الرسمي)
// - POST: رسائل JSON-RPC (initialize / tools/list / tools/call ...)
// - GET/DELETE: يتعامل معهما النقل (405 في الوضع العديم الجلسة)
// - وضع عديم الجلسة (stateless): كل طلب مستقل — الأنسب لـ Vercel serverless
//   حيث لا تضمان مثيل ثابت بين الطلبات، ولا يحتاج العملاء session-id.
// - إذا ضُبط MCP_ACCESS_TOKEN يُطلب Authorization: Bearer <token>.
// ============================================================
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.MCP_ACCESS_TOKEN?.trim();
  if (!expected) return true;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

async function handler(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized — مطلوب ترويسة Authorization: Bearer <MCP_ACCESS_TOKEN>" },
        id: null,
      },
      { status: 401 }
    );
  }

  // خادم ونقل جديدان لكل طلب (stateless) — لا حالة بين الطلبات
  const transport = new WebStandardStreamableHTTPServerTransport({
    // نفضّل SSE دائمًا ليصل إشعار التقدم (notifications/progress) للعميل حيًا
    enableJsonResponse: false,
  });
  const server = buildMcpServer();
  await server.connect(transport);
  return transport.handleRequest(req);
  // لا نغلق الخادم: جسم الاستجابة قد يبث تقدمًا حيًا حتى بعد إرجاع Response
}

export { handler as GET, handler as POST, handler as DELETE };
