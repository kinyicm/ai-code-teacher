import { NextRequest } from "next/server";
import { validateCustomBaseUrl } from "@/lib/modelConfig";

/**
 * 最大执行时间（秒）：一次完整生成实测最长约 16 秒，取 60 秒留足余量，
 * 覆盖高峰期模型响应变慢、网络抖动等情形，避免被 Vercel 默认的 10 秒
 * 函数超时截断（返回 504）。
 * 注意：这里只声明 maxDuration，不能显式声明 runtime —— 本项目
 * next.config 开启了 cacheComponents，显式声明 runtime 会导致构建失败。
 */
export const maxDuration = 60;

/**
 * 聊天补全接口（OpenAI 兼容 / 智谱 AI）
 * POST /api/chat
 *
 * 请求体：
 * {
 *   messages: [
 *     { role: "system", content: "..." },
 *     { role: "user", content: "..." }
 *   ],
 *   // 可选：自定义模型配置。未提供时回退到服务端环境变量（智谱默认）。
 *   baseUrl?: "https://api.openai.com/v1/chat/completions",
 *   apiKey?: "sk-...",
 *   model?: "gpt-4o-mini"
 * }
 *
 * 返回：SSE 流（text/event-stream），每个事件形如：
 *   data: {"content":"增量文本"}
 * 结束时发送：
 *   data: [DONE]
 */

// 默认模型与接口地址：可被环境变量覆盖。换模型 / 换服务商只需改 .env.local 里的
// LLM_MODEL / LLM_BASE_URL，不必改代码；留空则用下方智谱默认值（开箱即用）。
// 注意：这两个变量是服务端配置，与客户端可传的 baseUrl/apiKey 无关（见下方安全约束）。
const MODEL = process.env.LLM_MODEL?.trim() || "glm-4-flash";
const API_URL =
  process.env.LLM_BASE_URL?.trim() ||
  "https://open.bigmodel.cn/api/paas/v4/chat/completions";

/** 上游 429（模型过载）重试策略：最多重试 1 次、间隔 2 秒 */
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 2000;

/** 单次请求的消息条数上限：防止超大请求单次消耗大量额度 */
const MAX_MESSAGES = 50;
/** 单条消息 content 的最大字符数 */
const MAX_CONTENT_LENGTH = 20000;
/** 合法的消息角色 */
const VALID_ROLES = new Set(["system", "user", "assistant"]);

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * 校验 messages 的结构与规模，防止单次请求消耗大量额度。
 * 任一不满足返回中文错误（400），只指出第几条、哪个字段不合法，不回显用户内容：
 * - 条数上限 MAX_MESSAGES
 * - role 只能是 system / user / assistant
 * - content 必须是 string，且不超过 MAX_CONTENT_LENGTH 字符
 */
function validateMessages(messages: unknown[]): string | null {
  if (messages.length > MAX_MESSAGES) {
    return `消息条数超过上限（最多 ${MAX_MESSAGES} 条，实际 ${messages.length} 条）`;
  }
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") {
      return `第 ${i + 1} 条消息不是合法的对象`;
    }
    const m = msg as { role?: unknown; content?: unknown };
    if (typeof m.role !== "string" || !VALID_ROLES.has(m.role)) {
      return `第 ${i + 1} 条消息 role 非法（只能是 system / user / assistant）`;
    }
    if (typeof m.content !== "string") {
      return `第 ${i + 1} 条消息 content 必须是字符串`;
    }
    if (m.content.length > MAX_CONTENT_LENGTH) {
      return `第 ${i + 1} 条消息 content 超过长度上限（最多 ${MAX_CONTENT_LENGTH} 字符）`;
    }
  }
  return null;
}

/* ===== 公共额度限流：保护服务端内置 Key（默认模式）=====
 * Key 仅存在于服务端（ZHIPU_API_KEY 环境变量），从不会发送到浏览器，因此任何人都无法
 * 从网页代码、前端网络请求或接口响应中看到或复制它。默认模式下每次调用都走服务端 Key，
 * 为防止有人绕过界面、用脚本批量调用消耗部署者额度，这里按访问 IP 做频率限制。
 * - 使用自己的 Key（自定义模式）不占用公共额度，不限制；
 * - 本地开发（npm run dev，NODE_ENV=development）不限制；
 * - 计数器存于服务进程内存：本机 / 自托管单实例严格有效；部署到 Vercel 等 serverless
 *   平台时各实例独立、冷启动会重置（可防单实例突发刷量），如需严格全局上限可改接 Vercel KV/Redis。
 */
const PER_MINUTE_LIMIT = 10;
const PER_DAY_LIMIT = 100;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RateBucket {
  minuteCount: number;
  minuteResetAt: number;
  dayCount: number;
  dayResetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

/**
 * 获取客户端 IP（用于按 IP 限流）。
 * 只信任自有入口（Vercel 边缘 / 反向代理）会覆写的头，不信任客户端可写的第一段：
 * - 优先 x-real-ip：由入口代理直接写入真实客户端 IP；
 * - 否则取 x-forwarded-for 的【最后一段】——代理链中最靠近我们的入口追加的那段；
 * - 取第一段等于完全信任客户端伪造值，攻击者每次换一个值即可绕过配额。
 */
function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}

/** 返回限流错误提示；未超限（或无需限流）返回 null */
function checkRateLimit(req: NextRequest, usingServerKey: boolean): string | null {
  if (process.env.NODE_ENV === "development") return null;
  if (!usingServerKey) return null;

  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket) {
    bucket = {
      minuteCount: 0,
      minuteResetAt: now + MINUTE_MS,
      dayCount: 0,
      dayResetAt: now + DAY_MS,
    };
    rateBuckets.set(ip, bucket);
  }

  if (now >= bucket.minuteResetAt) {
    bucket.minuteCount = 0;
    bucket.minuteResetAt = now + MINUTE_MS;
  }
  if (now >= bucket.dayResetAt) {
    bucket.dayCount = 0;
    bucket.dayResetAt = now + DAY_MS;
  }
  bucket.minuteCount += 1;
  bucket.dayCount += 1;

  if (bucket.minuteCount > PER_MINUTE_LIMIT) {
    return `公共体验接口请求过于频繁（每分钟限 ${PER_MINUTE_LIMIT} 次）。请稍等片刻，或在右上角「模型设置」中填入你自己的 API Key 后继续（自定义 Key 不受限）。`;
  }
  if (bucket.dayCount > PER_DAY_LIMIT) {
    return `今日公共体验额度已用完（每天限 ${PER_DAY_LIMIT} 次）。请在右上角「模型设置」中填入你自己的 API Key（智谱 bigmodel.cn 可免费领取）继续使用。`;
  }

  // 防止 Map 无限增长：超过阈值时清理已过期的日窗口桶
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) {
      if (now >= value.dayResetAt) rateBuckets.delete(key);
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body: ChatRequestBody | null = await req.json().catch(() => null);
  const messages: ChatMessage[] | undefined = body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("请求体需要包含非空的 messages 数组", 400);
  }

  // 结构与规模校验放在限流之前：非法/超大请求直接 400，不占用公共额度计数，
  // 也不会打到上游模型消耗部署者 Key 的配额。
  const messagesErr = validateMessages(messages);
  if (messagesErr) return jsonError(messagesErr, 400);

  // 解析模型配置：使用者自带 Key 优先；未提供时使用服务端内置 Key（默认智谱，开箱即用）
  const clientKey = (body?.apiKey ?? "").trim();
  const serverKey = process.env.ZHIPU_API_KEY || "";
  const apiKey = clientKey || serverKey;
  const usingServerKey = !clientKey; // 前端未带 Key，即走服务端内置 Key（默认模式）

  // 安全约束：
  // 1. 使用服务端内置 Key 时，baseUrl/model 一律强制为默认智谱配置，客户端传值直接忽略，
  //    杜绝内置 Key 的 Authorization 头发往客户端指定的地址（凭据外泄）。
  // 2. 自定义 baseUrl 仅在客户端自带 Key 时允许，且必须 https + 域名白名单（防 SSRF）。
  let baseUrl: string;
  let model: string;
  if (usingServerKey) {
    baseUrl = API_URL;
    model = MODEL;
  } else {
    const customErr = validateCustomBaseUrl(body?.baseUrl);
    if (customErr) {
      return jsonError(`自定义接口地址无效：${customErr}`, 400);
    }
    baseUrl = (body?.baseUrl ?? "").trim();
    model = (body?.model ?? "").trim() || MODEL;
  }

  // 公共额度限流：仅在走服务端内置 Key 时按 IP 限频，防止脚本批量盗刷；
  // 自带 Key 与本地开发不受限。
  const limitError = checkRateLimit(req, usingServerKey);
  if (limitError) return jsonError(limitError, 429);

  if (!apiKey) {
    return jsonError(
      "未配置 API Key：请在页面右上角「模型设置」中粘贴你自己的 API Key，或在服务端配置 ZHIPU_API_KEY",
      400,
    );
  }

  // 上游请求（首次调用与 429 重试复用）
  const upstreamFetch = () =>
    fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      // 安全：不跟随任何 3xx 重定向（redirect: "manual" 保证 fetch 永不跳转，
      // 再配合下面的显式拒绝分支）。白名单域名若被诱导返回 302 指向内网，跟随会
      // 让服务器按外部返回的指令去探测内网；即使跨域重定向会按 Fetch 规范剥离
      // Authorization，也不允许"凭外部返回决定服务器连哪里"。
      redirect: "manual",
    });

  let upstream: Response;
  try {
    upstream = await upstreamFetch();

    // 上游 429（模型过载）自动重试：仅对 429 重试，其他状态码（含 401）一律不重试。
    // 重试必须发生在转发之前——拿到 2xx 之前绝不向客户端写任何 SSE 字节，
    // 否则 HTTP 响应已提交，无法再重试或改状态码。
    for (let attempt = 0; upstream.status === 429 && attempt < MAX_RETRIES; attempt++) {
      await upstream.body?.cancel().catch(() => {}); // 丢弃首次 429 响应体，释放连接
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      upstream = await upstreamFetch();
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "网络错误";
    // 脱敏：任何错误信息都不允许带出 Key
    const safeDetail = apiKey ? detail.split(apiKey).join("***") : detail;
    return jsonError(
      `无法连接到模型接口（${baseUrl}）：${safeDetail}。请检查接口地址与网络连接`,
      502,
    );
  }

  // 显式拒绝重定向：manual 模式下 3xx 以响应形式返回（本运行时 status 仍为 302；
  // 个别实现按规范给 opaque 响应 status=0），两种情况都绝不跟随并返回 502。
  if (upstream.status === 0 || (upstream.status >= 300 && upstream.status < 400)) {
    return jsonError(
      `模型接口返回了重定向（${upstream.status === 0 ? "3xx" : upstream.status}），出于安全考虑已拒绝跟随。请直接使用最终的接口地址`,
      502,
    );
  }

  // 重试后仍 429：是模型过载，不是用户请求有误
  if (upstream.status === 429) {
    return jsonError("模型接口当前访问量过大（HTTP 429），请稍后重试", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text();
    // 脱敏：即使上游错误体意外回显了 Key，也绝不返回给浏览器
    const safeText = (apiKey ? raw.split(apiKey).join("***") : raw).slice(0, 300);
    return jsonError(`模型 API 请求失败（${upstream.status}）: ${safeText}`, 502);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";

      function processLines(flush = false) {
        const lines = buffer.split("\n");
        if (!flush) {
          buffer = lines.pop() ?? "";
        }
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return true;
          }

          try {
            const json = JSON.parse(data);
            const content: unknown = json.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content.length > 0) {
              const payload = `data: ${JSON.stringify({ content })}\n\n`;
              controller.enqueue(encoder.encode(payload));
            }
          } catch {
            // 忽略无法解析的 chunk
          }
        }
        return false;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (processLines()) return;
        }
        // 循环结束后：冲刷解码器缓存并处理剩余内容
        buffer += decoder.decode();
        if (buffer.length > 0 && processLines(true)) return;
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
