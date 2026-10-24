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

/**
 * 自定义模型接口域名白名单（仅 https）。
 * 自定义 baseUrl 仅在用户自带 API Key 时允许使用，且域名必须在此白名单内，
 * 防止 SSRF（请求内网/云元数据等地址）以及利用服务端内置 Key 做凭据外泄。
 * 该列表是唯一来源：服务端 route.ts 与前端模型设置面板共用，新增服务商只需在此追加域名。
 */
export const ALLOWED_CUSTOM_HOSTS = new Set([
  "api.openai.com", // OpenAI
  "api.deepseek.com", // DeepSeek
  "api.moonshot.cn", // Kimi / Moonshot
  "dashscope.aliyuncs.com", // 阿里云百炼（通义）
  "open.bigmodel.cn", // 智谱 AI（本项目默认服务商，允许自定义模式自带 Key 使用）
]);

/** 校验自定义 baseUrl；合法返回 null，非法返回具体错误信息 */
export function validateCustomBaseUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return "自定义模式必须提供接口地址（baseUrl）";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "不是合法的 URL";
  }
  if (url.protocol !== "https:") return "仅支持 https";
  if (url.username || url.password) return "不允许包含账号密码";
  if (url.port && url.port !== "443") return "不允许自定义端口";
  if (!ALLOWED_CUSTOM_HOSTS.has(url.hostname)) return "不在允许的域名白名单内";
  return null;
}

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
