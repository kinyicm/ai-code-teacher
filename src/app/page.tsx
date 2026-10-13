"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownMessage from "@/components/MarkdownMessage";
import CodeEditor from "@/components/CodeEditor";
import {
  MODES,
  MODE_LABEL,
  systemPromptFor,
  type ModeId,
} from "@/lib/modes";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: ModeId;
}

/**
 * 调用 /api/chat 获取 SSE 流式回答，onDelta 在每次收到增量时回调（参数为累计全文）。
 * 返回 { ok, content, error }。
 */
async function streamChat(
  mode: ModeId,
  userContent: string,
  onDelta: (full: string) => void,
): Promise<{ ok: boolean; content: string; error?: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPromptFor(mode) },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    return {
      ok: false,
      content: "",
      error: err?.error ?? `请求失败（${res.status}）`,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const flush = (finish: boolean) => {
    const parts = buffer.split("\n\n");
    if (!finish) buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as { content?: string };
        if (typeof json.content === "string") {
          full += json.content;
          onDelta(full);
        }
      } catch {
        // 忽略无法解析的 chunk
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flush(false);
    }
    buffer += decoder.decode();
    flush(true);
  } finally {
    reader.releaseLock();
  }

  return { ok: true, content: full };
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 6-6 6 6 6" />
      <path d="m16 6 6 6-6 6" />
    </svg>
  );
}

const STORAGE_KEY = "ai-code-teacher-messages";

export default function Home() {
  const [mode, setMode] = useState<ModeId>("explain");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [language, setLanguage] = useState("java");

  const scrollRef = useRef<HTMLDivElement>(null);

  const activeMode = MODES.find((item) => item.id === mode) ?? MODES[0];

  // 页面加载时从localStorage恢复对话
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setMessages(JSON.parse(saved));
      }
    } catch {
      // 数据损坏则忽略
    }
    setLoaded(true);
  }, []);

  // messages变化时保存到localStorage
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // 存储满则忽略
    }
  }, [messages, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isThinking]);

  async function handleSubmit() {
    const content = input.trim();
    if (!content || isThinking) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      mode,
    };
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsThinking(true);

    // 先放入一个空的 AI 气泡，后续按流式增量填充内容
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", mode },
    ]);

    const applyToAssistant = (content: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content } : m)),
      );
    };

    try {
      const result = await streamChat(mode, content, applyToAssistant);

      if (!result.ok) {
        applyToAssistant(`> ⚠️ 请求失败：${result.error}`);
      } else if (!result.content) {
        applyToAssistant("> （模型没有返回内容，请重试）");
      }
    } catch (err) {
      applyToAssistant(
        `> ⚠️ 网络错误：${err instanceof Error ? err.message : "未知错误"}`,
      );
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 ring-inset">
            <CodeIcon className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-zinc-50">
              AI 代码学习助手
            </h1>
            <p className="text-xs text-zinc-500">
              面向编程零基础学生的代码辅导
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          已接入智谱 AI · glm-4.7-flash
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-5 py-3">
        <span className="mr-1 text-xs text-zinc-500">模式</span>
        {MODES.map((item) => {
          const active = item.id === mode;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/30"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {item.label}
            </button>
          );
        })}
        <p className="ml-auto hidden text-xs text-zinc-500 md:block">
          {activeMode.description}
        </p>
      </div>

      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        {/* 左侧：输入区 */}
        <section className="flex min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 lg:w-[44%] lg:shrink-0">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-medium text-zinc-300">输入区</h2>
            <span className="text-xs text-zinc-500">{input.length} 字符</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            {/* 语言选择 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">语言</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-indigo-500/60"
              >
                <option value="java">Java</option>
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
              </select>
            </div>

            <CodeEditor
              value={input}
              onChange={setInput}
              language={language}
              onSubmit={handleSubmit}
              placeholder={activeMode.placeholder}
            />

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                粘贴代码或描述报错，Ctrl / ⌘ + Enter 发送
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setInput("")}
                  disabled={!input}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!input.trim() || isThinking}
                  className="rounded-lg bg-indigo-500 px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isThinking ? "生成中…" : "发送"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 右侧：AI 回答区 */}
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-medium text-zinc-300">AI 回答</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">
                {messages.length} 条对话
              </span>
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={messages.length === 0}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                清空对话
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="scroll-area flex-1 space-y-4 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && !isThinking ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-zinc-800/60 text-zinc-500">
                  <CodeIcon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-zinc-300">还没有对话</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    选择上方模式，在左侧粘贴代码或描述报错，点击「发送」开始
                  </p>
                </div>
              </div>
            ) : null}

            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5">
                    <p className="mb-1 text-[11px] text-indigo-300/80">
                      {MODE_LABEL[message.mode]} · 你的输入
                    </p>
                    <pre className="font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-zinc-100">
                      {message.content}
                    </pre>
                  </div>
                </div>
              ) : (
                <div
                  key={message.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3.5"
                >
                  <p className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                    AI 助手 · {MODE_LABEL[message.mode]}
                  </p>
                  <MarkdownMessage content={message.content} />
                </div>
              ),
            )}

            {isThinking ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3.5 text-sm text-zinc-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                正在生成回答…
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
