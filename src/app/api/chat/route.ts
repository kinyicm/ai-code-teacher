import { NextRequest } from "next/server";

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

const MODEL = "glm-4.7-flash";
const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

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

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
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

  // 解析模型配置：使用者自带 Key 优先；未提供时使用服务端内置 Key（默认智谱，开箱即用）
  const baseUrl = (body?.baseUrl ?? "").trim() || API_URL;
  const clientKey = (body?.apiKey ?? "").trim();
  const serverKey = process.env.ZHIPU_API_KEY || "";
  const apiKey = clientKey || serverKey;
  const usingServerKey = !clientKey; // 前端未带 Key，即走服务端内置 Key（默认模式）
  const model = (body?.model ?? "").trim() || MODEL;

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

  let upstream: Response;
  try {
    upstream = await fetch(baseUrl, {
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
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "网络错误";
    // 脱敏：任何错误信息都不允许带出 Key
    const safeDetail = apiKey ? detail.split(apiKey).join("***") : detail;
    return jsonError(
      `无法连接到模型接口（${baseUrl}）：${safeDetail}。请检查接口地址与网络连接`,
      502,
    );
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
