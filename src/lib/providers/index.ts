// سجل المحولات: كل مفتاح يُخدم بمحول مزوده (بغض النظر عن ترتيب المزودين)
import type { ProviderAdapter } from "./types";
import { kieAdapter } from "./kie";
import { cometapiAdapter } from "./cometapi";

export function getAdapter(provider: string): ProviderAdapter {
  if (provider === "kie") return kieAdapter;
  if (provider === "cometapi") return cometapiAdapter;
  throw new Error(`مزود غير معروف: ${provider}`);
}

export { kieAdapter, cometapiAdapter };
export * from "./types";
