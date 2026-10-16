/**
 * 模型配置：默认智谱大模型 或 用户自定义的 OpenAI 兼容 API。
 * 配置保存在浏览器 localStorage，发送时透传给 /api/chat 代理路由；
 * 自定义 API Key 仅在浏览器与本站代理之间传输，不会暴露给第三方。
 */

export type ModelSource = "default" | "custom";

export interface ModelConfig {
  source: ModelSource;
  /** 自定义接口地址，如 https://api.openai.com/v1/chat/completions */
  baseUrl: string;
  /** 自定义 API Key */
  apiKey: string;
  /** 自定义模型名，如 gpt-4o-mini */
  model: string;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  source: "default",
  baseUrl: "",
  apiKey: "",
  model: "",
};

export const MODEL_STORAGE_KEY = "ai-code-teacher-model-config";

export function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MODEL_CONFIG };
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "source" in parsed) {
      const cfg = parsed as { source?: unknown; baseUrl?: unknown; apiKey?: unknown; model?: unknown };
      return {
        source: cfg.source === "custom" ? "custom" : "default",
        baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : "",
        apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
        model: typeof cfg.model === "string" ? cfg.model : "",
      };
    }
    return { ...DEFAULT_MODEL_CONFIG };
  } catch {
    return { ...DEFAULT_MODEL_CONFIG };
  }
}

export function saveModelConfig(config: ModelConfig): void {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 存储失败忽略（如隐私模式）
  }
}
