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

export async function POST(req: NextRequest) {
  const body: ChatRequestBody | null = await req.json().catch(() => null);
  const messages: ChatMessage[] | undefined = body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("请求体需要包含非空的 messages 数组", 400);
  }

  // 解析模型配置：自定义优先，未提供时回退到默认智谱
  const baseUrl = (body?.baseUrl ?? "").trim() || API_URL;
  const apiKey =
    (body?.apiKey ?? "").trim() || process.env.ZHIPU_API_KEY || "";
  const model = (body?.model ?? "").trim() || MODEL;

  if (!apiKey) {
    return jsonError(
      "未配置 API Key：请在模型设置中粘贴你的 API Key，或确认服务端已配置 ZHIPU_API_KEY",
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
    return jsonError(
      `无法连接到模型接口（${baseUrl}）：${err instanceof Error ? err.message : "网络错误"}。请检查接口地址与网络连接`,
      502,
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return jsonError(
      `模型 API 请求失败（${upstream.status}）: ${text.slice(0, 300)}`,
      502,
    );
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
