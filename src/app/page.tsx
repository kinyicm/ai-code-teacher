"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownMessage from "@/components/MarkdownMessage";
import CodeEditor from "@/components/CodeEditor";
import HistoryPanel from "@/components/HistoryPanel";
import ErrorHandbook from "@/components/ErrorHandbook";
import ModelSettings from "@/components/ModelSettings";
import WeaknessAnalysis from "@/components/WeaknessAnalysis";
import {
  MODES,
  MODE_LABEL,
  systemPromptFor,
  WEAKNESS_ANALYSIS_PROMPT,
  type ModeId,
} from "@/lib/modes";
import { looksLikeErrorStack, parseJavaError } from "@/lib/errorParser";
import {
  classifyError,
  buildOfflineAnswer,
  KNOWLEDGE,
  type OfflineMatch,
} from "@/lib/errorKnowledge";
import {
  loadModelConfig,
  saveModelConfig,
  type ModelConfig,
} from "@/lib/modelConfig";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: ModeId;
  time?: string;
}

/**
 * 调用 /api/chat 获取 SSE 流式回答，onDelta 在每次收到增量时回调（参数为累计全文）。
 * history 为之前的对话（{role, content}），用于多轮上下文。
 * 返回 { ok, content, error }。
 */
async function streamChat(
  mode: ModeId,
  userContent: string,
  history: { role: "user" | "assistant"; content: string }[],
  signal: AbortSignal | undefined,
  onDelta: (full: string) => void,
  modelConfig: ModelConfig,
  systemPromptOverride?: string,
): Promise<{ ok: boolean; content: string; error?: string }> {
  // 组装：system + 历史（最近10条）+ 当前问题
  const recentHistory = history.slice(-10);
  const payloadMessages = [
    {
      role: "system" as const,
      content: systemPromptOverride ?? systemPromptFor(mode),
    },
    ...recentHistory,
    { role: "user" as const, content: userContent },
  ];

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: payloadMessages,
      // 自定义模型时把配置传给 /api/chat 代理，默认智谱则不带（回退服务端环境变量）
      ...(modelConfig.source === "custom"
        ? {
            baseUrl: modelConfig.baseUrl.trim() || undefined,
            apiKey: modelConfig.apiKey.trim() || undefined,
            model: modelConfig.model.trim() || undefined,
          }
        : {}),
    }),
    signal,
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

function emptyMessages(): Record<ModeId, ChatMessage[]> {
  return { explain: [], debug: [], optimize: [], practice: [] };
}

/** 全局最多保留 100 条对话：超出时从消息数最多的模式里丢弃最旧的一条 */
function pruneAll(
  record: Record<ModeId, ChatMessage[]>,
): Record<ModeId, ChatMessage[]> {
  const keys = Object.keys(record) as ModeId[];
  const total = keys.reduce((n, k) => n + record[k].length, 0);
  if (total <= 100) return record;
  const next: Record<ModeId, ChatMessage[]> = { ...record };
  let overflow = total - 100;
  while (overflow > 0) {
    const longest = keys.reduce((a, b) =>
      next[a].length >= next[b].length ? a : b,
    );
    if (next[longest].length === 0) break;
    next[longest] = next[longest].slice(1);
    overflow--;
  }
  return next;
}

export default function Home() {
  const [mode, setMode] = useState<ModeId>("explain");
  const [input, setInput] = useState("");
  // 每个模式独立维护自己的对话（各自独立的 AI 回答框），互不干扰
  const [messagesByMode, setMessagesByMode] = useState<
    Record<ModeId, ChatMessage[]>
  >(() => emptyMessages());
  // 当前正在流式生成的模式（null 表示空闲）
  const [generatingMode, setGeneratingMode] = useState<ModeId | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [language, setLanguage] = useState("java");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [handbookOpen, setHandbookOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() =>
    loadModelConfig(),
  );
  const [notice, setNotice] = useState<string | null>(null);
  // 首屏探测服务端是否已配置模型密钥：null 表示尚未探测完成。
  // 未配置时在顶部给出配置指引，避免新用户点了发送才看到报错。
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  // 服务端实际生效的默认模型名（可能被 LLM_MODEL 覆盖），用于顶部显示，避免写死
  const [effectiveModel, setEffectiveModel] = useState("");
  // 薄弱点分析结果：以弹窗形式独立展示，不进入任一模式的对话流
  const [weakness, setWeakness] = useState<{
    id: string;
    content: string;
    isLoading: boolean;
  } | null>(null);

  const scrollRefs = useRef<Partial<Record<ModeId, HTMLDivElement | null>>>({});
  const abortRef = useRef<AbortController | null>(null);
  const weaknessAbortRef = useRef<AbortController | null>(null);

  // 有任一模式正在生成即视为 isThinking（沿用历史逻辑）
  const isThinking = generatingMode !== null;
  // 当前模式的消息（渲染当前 AI 回答框）
  const messages = messagesByMode[mode] ?? [];
  // 所有模式消息合并（历史记录面板、薄弱点分析、顶部计数用）
  const allMessages = Object.values(messagesByMode).flat();

  // 首屏探测服务端配置。放在 promise 回调里更新状态（非同步 setState），
  // 因此不触发 react-hooks/set-state-in-effect。
  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { keyConfigured?: boolean; model?: string }) => {
        if (!alive) return;
        setKeyConfigured(Boolean(d.keyConfigured));
        setEffectiveModel(typeof d.model === "string" ? d.model : "");
      })
      .catch(() => {
        if (alive) setKeyConfigured(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 向指定模式追加消息（自动裁剪到全局 100 条上限） */
  function appendToMode(modeId: ModeId, items: ChatMessage[]) {
    setMessagesByMode((prev) =>
      pruneAll({ ...prev, [modeId]: [...prev[modeId], ...items] }),
    );
  }

  /** 流式更新指定模式里某条助手消息的内容 */
  function patchAssistant(modeId: ModeId, id: string, content: string) {
    setMessagesByMode((prev) => ({
      ...prev,
      [modeId]: prev[modeId].map((m) => (m.id === id ? { ...m, content } : m)),
    }));
  }

  const activeMode = MODES.find((item) => item.id === mode) ?? MODES[0];

  // 页面加载时从localStorage恢复各模式对话
  // 本 effect 内的同步 setState 属正当模式：localStorage 在服务端不存在，
  // 若放进 useState 的初始化函数会导致 SSR 首屏与客户端首帧不一致（水合警告），
  // 因此只能在 mount 后的 effect 里同步写入。故对本段定向关闭该规则。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // 旧格式（单一消息数组）：按每条消息的 mode 字段分到对应模式的对话
          const grouped = emptyMessages();
          for (const m of parsed as ChatMessage[]) {
            const target = MODES.some((item) => item.id === m.mode)
              ? m.mode
              : "explain";
            grouped[target].push(m);
          }
          setMessagesByMode(grouped);
        } else if (parsed && typeof parsed === "object") {
          const restored = emptyMessages();
          for (const k of Object.keys(restored) as ModeId[]) {
            const arr = (parsed as Record<string, unknown>)[k];
            if (Array.isArray(arr)) restored[k] = arr as ChatMessage[];
          }
          setMessagesByMode(restored);
        }
      }
    } catch {
      // 数据损坏则忽略
    }
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 消息变化时保存到localStorage（全局最多保留100条）
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messagesByMode));
    } catch {
      // 存储满则忽略
    }
  }, [messagesByMode, loaded]);

  // 正在生成的模式（或当前模式）有新内容时滚动到底部
  useEffect(() => {
    const target = generatingMode ?? mode;
    const el = scrollRefs.current[target];
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messagesByMode, mode, generatingMode]);

  // 提示自动消失
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  // 发送一轮对话：追加用户消息 + 空 AI 气泡，流式填充，统一错误处理
  async function runTurn(opts: {
    userBubbleContent: string;
    payloadContent: string;
    history: { role: "user" | "assistant"; content: string }[];
    systemPrompt?: string;
  }) {
    if (isThinking) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: opts.userBubbleContent,
      mode,
      time: new Date().toISOString(),
    };
    const assistantId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;

    appendToMode(mode, [userMessage]);
    setGeneratingMode(mode);

    // 先放入一个空的 AI 气泡，后续按流式增量填充内容
    appendToMode(mode, [
      {
        id: assistantId,
        role: "assistant" as const,
        content: "",
        mode,
        time: new Date().toISOString(),
      },
    ]);

    const applyToAssistant = (content: string) => {
      patchAssistant(mode, assistantId, content);
    };

    try {
      const result = await streamChat(
        mode,
        opts.payloadContent,
        opts.history,
        controller.signal,
        applyToAssistant,
        modelConfig,
        opts.systemPrompt,
      );

      if (!result.ok) {
        applyToAssistant(`> ⚠️ 请求失败：${result.error}`);
      } else if (!result.content) {
        applyToAssistant("> （模型没有返回内容，请重试）");
      }
    } catch (err) {
      // 用户主动中断：保留已生成内容，追加停止提示
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessagesByMode((prev) => ({
          ...prev,
          [mode]: prev[mode].map((m) => {
            if (m.id !== assistantId) return m;
            const generated = m.content.trim();
            return {
              ...m,
              content: generated
                ? `${generated}\n\n_（已停止生成）_`
                : "_（已停止生成）_",
            };
          }),
        }));
      } else {
        applyToAssistant(
          `> ⚠️ 网络错误：${err instanceof Error ? err.message : "未知错误"}`,
        );
      }
    } finally {
      setGeneratingMode(null);
      abortRef.current = null;
    }
  }

  // 离线解答：命中内置错误知识库时，不经 API 直接追加用户气泡 + 完整回答气泡
  function appendOfflineReply(userBubbleContent: string, off: OfflineMatch) {
    const k = KNOWLEDGE.find((item) => item.id === off.type);
    if (!k) return;
    const time = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userBubbleContent,
      mode,
      time,
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: buildOfflineAnswer(k, off.reason, off.lang),
      mode,
      time,
    };
    appendToMode(mode, [userMessage, assistantMessage]);
  }

  async function handleSubmit() {
    const content = input.trim();
    if (!content || isThinking) return;

    // 找 Bug 模式离线优先：命中内置错误知识库 → 本地直接解答，不调用 AI API
    if (mode === "debug") {
      const off = classifyError(content);
      if (off) {
        setInput("");
        appendOfflineReply(content, off);
        return;
      }
    }

    // 报错堆栈智能解析：如果检测到 Java 异常，自动附加结构化摘要
    let finalContent = content;
    if (looksLikeErrorStack(content)) {
      const parsed = parseJavaError(content);
      if (parsed.isJavaStack && parsed.summary) {
        finalContent = `【系统已自动识别为 Java 报错堆栈，解析结果如下】\n${parsed.summary}\n\n【原始报错】\n${content}\n\n请基于以上解析结果，用通俗语言解释这个错误的原因和修复方法。`;
      }
    }

    // 构造历史对话：过滤掉空内容和错误提示，只保留 role + content
    const history = messages
      .filter(
        (m) =>
          m.content.trim() !== "" &&
          !m.content.startsWith("> ⚠️") &&
          !m.content.startsWith("> （"),
      )
      .map((m) => ({ role: m.role, content: m.content }));

    setInput("");
    await runTurn({
      userBubbleContent: content,
      payloadContent: finalContent,
      history,
    });
  }

  // 「分析薄弱点」：基于历史记录做个性化分析。
  // 结果写入独立的 weakness 面板，不再追加到 AI 回答区的对话流。
  async function handleAnalyzeWeakness() {
    if (isThinking || weakness?.isLoading) return;

    // 基于所有模式的对话记录做分析，跨模式发现薄弱环节
    const meaningful = allMessages
      .filter(
        (m) =>
          m.content.trim() !== "" &&
          !m.content.startsWith("> ⚠️") &&
          !m.content.startsWith("> （"),
      )
      .slice(-20);

    if (meaningful.length === 0) {
      setNotice("还没有足够的历史对话，先发几条消息再来分析吧");
      return;
    }

    const historyText = meaningful
      .map(
        (m) =>
          `【${m.role === "user" ? "学生" : "AI 助手"} · ${MODE_LABEL[m.mode]}】\n${m.content}`,
      )
      .join("\n\n---\n\n");

    const payloadContent = `【分析请求】\n📊 请根据我们的历史对话，分析我的薄弱环节并给出改进建议\n\n【我的历史对话记录】\n${historyText}\n\n请基于以上记录做个性化薄弱点分析。`;

    const id = crypto.randomUUID();
    setWeakness({ id, content: "", isLoading: true });

    const controller = new AbortController();
    weaknessAbortRef.current = controller;

    const apply = (content: string) => {
      setWeakness((cur) => (cur ? { ...cur, content } : cur));
    };

    try {
      const result = await streamChat(
        mode,
        payloadContent,
        [],
        controller.signal,
        apply,
        modelConfig,
        WEAKNESS_ANALYSIS_PROMPT,
      );

      if (!result.ok) {
        apply(`> ⚠️ 请求失败：${result.error}`);
      } else if (!result.content) {
        apply("> （模型没有返回内容，请重试）");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setWeakness((cur) =>
          cur
            ? {
                ...cur,
                content: cur.content.trim()
                  ? `${cur.content}\n\n_（已停止分析）_`
                  : "_（已停止分析）_",
              }
            : cur,
        );
      } else {
        apply(
          `> ⚠️ 网络错误：${err instanceof Error ? err.message : "未知错误"}`,
        );
      }
    } finally {
      weaknessAbortRef.current = null;
      setWeakness((cur) => (cur ? { ...cur, isLoading: false } : cur));
    }
  }

  function handleStopWeakness() {
    weaknessAbortRef.current?.abort();
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleCopy(content: string, id: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      // 剪贴板不可用时忽略
    }
  }

  // 一键复制输入框内容
  async function handleCopyInput() {
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input);
      setNotice("输入内容已复制");
    } catch {
      setNotice("复制失败，请手动选择复制");
    }
  }

  // 跨所有模式查找并删除指定消息
  function handleDeleteMessage(id: string) {
    setMessagesByMode((prev) => {
      const next: Record<ModeId, ChatMessage[]> = { ...prev };
      for (const k of Object.keys(next) as ModeId[]) {
        if (next[k].some((m) => m.id === id)) {
          next[k] = next[k].filter((m) => m.id !== id);
        }
      }
      return next;
    });
  }

  // 跨所有模式查找并编辑指定消息内容
  function handleEditMessage(id: string, content: string) {
    setMessagesByMode((prev) => {
      const next: Record<ModeId, ChatMessage[]> = { ...prev };
      for (const k of Object.keys(next) as ModeId[]) {
        if (next[k].some((m) => m.id === id)) {
          next[k] = next[k].map((m) => (m.id === id ? { ...m, content } : m));
        }
      }
      return next;
    });
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-[13px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            历史记录
            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-400">
              {allMessages.length}/100
            </span>
          </button>
          <button
            type="button"
            onClick={() => setModelSettingsOpen(true)}
            title="选择默认智谱大模型，或粘贴自己的 OpenAI 兼容 API Key"
            className="hidden items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-100 sm:flex"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                modelConfig.source === "custom"
                  ? "bg-violet-400"
                  : "bg-emerald-400"
              }`}
            />
            {modelConfig.source === "custom"
              ? `自定义模型 · ${modelConfig.model || "未命名"}`
              : `默认 · ${effectiveModel || "glm-4-flash"}`}
          </button>
        </div>
      </header>

      {keyConfigured === false ? (
        <div className="flex flex-wrap items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3">
          <span aria-hidden className="mt-0.5 text-base leading-none">
            ⚠️
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-amber-100">
              尚未配置 API Key —— 配置后即可开始使用
            </p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-amber-200/90">
              <li>
                在项目根目录创建{" "}
                <code className="rounded bg-black/30 px-1">.env.local</code>
                ，写入{" "}
                <code className="rounded bg-black/30 px-1">
                  ZHIPU_API_KEY=你的Key
                </code>
                ，然后重启服务
              </li>
              <li>
                或点右上角「模型设置」→ 自定义 API：接口地址填{" "}
                <code className="rounded bg-black/30 px-1">
                  https://open.bigmodel.cn/api/paas/v4/chat/completions
                </code>
                ，模型名填{" "}
                <code className="rounded bg-black/30 px-1">glm-4-flash</code>
              </li>
              <li>
                Key 可在{" "}
                <a
                  href="https://bigmodel.cn/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  bigmodel.cn
                </a>{" "}
                免费领取，新用户有免费额度
              </li>
            </ol>
          </div>
          <button
            type="button"
            onClick={() => setModelSettingsOpen(true)}
            className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1.5 text-[12px] text-amber-100 transition-colors hover:bg-amber-500/20"
          >
            去设置
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-5 py-3">
        <span className="mr-1 text-xs text-zinc-500">模式</span>
        {MODES.map((item) => {
          const active = item.id === mode;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              title={`切换到「${item.label}」页面（各自独立对话）`}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/30"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {item.label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  active ? "bg-white/20 text-white" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {(messagesByMode[item.id] ?? []).length}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleAnalyzeWeakness}
          disabled={isThinking || weakness?.isLoading}
          title="根据历史对话分析薄弱点，帮助进步"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 text-[13px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          📊 分析薄弱点
        </button>
        <button
          type="button"
          onClick={() => setHandbookOpen(true)}
          title="查看四种常见代码错误类型（语法/编译/运行时/逻辑）的离线知识库"
          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-[13px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          📚 错误手册
        </button>
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

            {/* 报错堆栈智能解析提示 */}
            {looksLikeErrorStack(input) ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  已识别为 Java 报错，自动解析如下：
                </p>
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-amber-200/80">
                  {parseJavaError(input).summary || "（解析中…）"}
                </pre>
              </div>
            ) : null}

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
                  onClick={handleCopyInput}
                  disabled={!input}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  复制
                </button>
                <button
                  type="button"
                  onClick={() => setInput("")}
                  disabled={!input}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  清空
                </button>
                {isThinking ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-[13px] font-medium text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    停止生成
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!input.trim()}
                    className="rounded-lg bg-indigo-500 px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 右侧：AI 回答区 —— 每个模式一个独立页面，各自独立的回答框与对话 */}
        {MODES.map((item) => {
          const active = item.id === mode;
          const msgs = messagesByMode[item.id] ?? [];
          const thinking = generatingMode === item.id;
          return (
            <section
              key={item.id}
              className={`min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 ${
                active ? "flex" : "hidden"
              }`}
            >
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <h2 className="text-sm font-medium text-zinc-300">
                  AI 回答 · {MODE_LABEL[item.id]}
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {msgs.length} 条对话
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setMessagesByMode((prev) => ({ ...prev, [item.id]: [] }))
                    }
                    disabled={msgs.length === 0}
                    className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    清空对话
                  </button>
                </div>
              </div>

              <div
                ref={(el) => {
                  scrollRefs.current[item.id] = el;
                }}
                className="scroll-area flex-1 space-y-4 overflow-y-auto px-4 py-4"
              >
                {msgs.length === 0 && !thinking ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-zinc-800/60 text-zinc-500">
                      <CodeIcon className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm text-zinc-300">
                        「{MODE_LABEL[item.id]}」还没有对话
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.description}，在左侧输入后点击「发送」
                      </p>
                    </div>
                  </div>
                ) : null}

                {msgs.map((message) =>
                  message.role === "user" ? (
                    <div key={message.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl rounded-br-sm border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <p className="text-[11px] text-indigo-300/80">
                            {MODE_LABEL[message.mode]} · 你的输入
                          </p>
                          <button
                            type="button"
                            onClick={() => handleCopy(message.content, message.id)}
                            disabled={!message.content.trim()}
                            className="text-[11px] text-indigo-300/70 transition-colors hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {copiedId === message.id ? "已复制 ✓" : "复制"}
                          </button>
                        </div>
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
                      <div className="mb-2 flex items-center justify-between">
                        <p className="flex items-center gap-2 text-[11px] text-zinc-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                          AI 助手 · {MODE_LABEL[message.mode]}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleCopy(message.content, message.id)}
                          disabled={!message.content.trim()}
                          className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {copiedId === message.id ? "已复制 ✓" : "复制"}
                        </button>
                      </div>
                      <MarkdownMessage content={message.content} />
                    </div>
                  ),
                )}

                {thinking ? (
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3.5 text-sm text-zinc-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    正在生成回答…
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </main>

      {notice ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 shadow-lg">
          {notice}
        </div>
      ) : null}

      {weakness ? (
        <WeaknessAnalysis
          id={weakness.id}
          content={weakness.content}
          isLoading={weakness.isLoading}
          onClose={() => {
            weaknessAbortRef.current?.abort();
            setWeakness(null);
          }}
          onStop={handleStopWeakness}
        />
      ) : null}

      {historyOpen ? (
        <HistoryPanel
          records={allMessages}
          onDelete={handleDeleteMessage}
          onEdit={handleEditMessage}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {handbookOpen ? (
        <ErrorHandbook
          onClose={() => setHandbookOpen(false)}
          onPick={(lang, code) => {
            setLanguage(lang);
            setInput(code);
            setHandbookOpen(false);
          }}
        />
      ) : null}

      {modelSettingsOpen ? (
        <ModelSettings
          current={modelConfig}
          onSave={(config) => {
            setModelConfig(config);
            saveModelConfig(config);
            setNotice(
              config.source === "default"
                ? "已恢复默认智谱大模型"
                : "已保存自定义模型配置",
            );
          }}
          onClose={() => setModelSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
