import type { NextConfig } from "next";

// ملاحظة: لا نتجاهل أخطاء TypeScript أبدًا — معيار القبول 1 يتطلب tsc نظيفًا.
// output: standalone مناسب للتشغيل الذاتي؛ وVercel يتجاهله بأمان ويبني وفق نظامه.
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
};

export default nextConfig;
