import { NextRequest } from "next/server";

/**
 * 智谱 AI（BigModel）聊天补全接口
 * POST /api/chat
 *
 * 请求体：
 * {
 *   messages: [
 *     { role: "system", content: "..." },
 *     { role: "user", content: "..." }
 *   ]
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

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const messages: ChatMessage[] | undefined = body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("请求体需要包含非空的 messages 数组", 400);
  }

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return jsonError("服务端未配置 ZHIPU_API_KEY", 500);
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;
  let upstream: Response;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    upstream = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
      }),
    });

    if (upstream.ok && upstream.body) break;

    // 非429错误直接返回，不重试
    if (upstream.status !== 429) {
      const text = await upstream.text();
      return jsonError(
        `智谱 API 请求失败（${upstream.status}）: ${text}`,
        502,
      );
    }

    // 429限流：等待后重试
    lastError = await upstream.text();
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  if (!upstream!.ok || !upstream!.body) {
    return jsonError(
      `智谱 API 在重试 ${MAX_RETRIES} 次后仍失败（429）: ${lastError}`,
      502,
    );
  }

  const reader = upstream!.body!.getReader();
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
