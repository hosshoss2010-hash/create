// ============================================================
// واجهة المزودات الموحدة — أي خطأ خارجي يُرمى كـ ProviderError
// ليُصنَّف لاحقًا في classifyProviderError (قسم 4.2)
// ============================================================

export class ProviderError extends Error {
  constructor(
    public status: number | undefined, // undefined = خطأ شبكة/timeout لدينا
    message: string
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface CheckResult {
  status: "processing" | "completed" | "failed";
  urls?: string[];
  error?: string;
  progress?: number;
}

export interface ProviderAdapter {
  /** بناء جسم input الخاص بالمزود من معطيات الأداة */
  buildInput(type: "image" | "video", args: Record<string, unknown>): Record<string, unknown>;
  /** مهمة غير متزامنة (فيديو وبعض الصور): تعيد providerTaskId */
  createTask(key: string, providerModel: string, input: Record<string, unknown>): Promise<{ providerTaskId: string }>;
  /** صور متزامنة إن كان المزود يدعمها (تعيد الروابط فورًا) */
  createImageSync?(key: string, providerModel: string, input: Record<string, unknown>): Promise<{ urls: string[] }>;
  /** استعلام حالة مهمة جارية */
  checkTask(key: string, providerTaskId: string): Promise<CheckResult>;
}
