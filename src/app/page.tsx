"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownMessage from "@/components/MarkdownMessage";
import CodeEditor, { type CodeEditorHandle } from "@/components/CodeEditor";
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
import { detectLanguage, LANG_LABEL } from "@/lib/languageDetect";

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

  // 语言上下文：由程序判定输入代码的语言，并明确要求模型沿用同一语言。
  // 原先只靠模型自己猜，实测出现过「Java 代码的修复示例给成 JavaScript」，
  // 而「判断语言」本就该由程序完成（见 lib/languageDetect.ts），不应交给模型。
  const detected = detectLanguage(userContent);
  const basePrompt = systemPromptOverride ?? systemPromptFor(mode);
  const finalSystemPrompt = detected
    ? `${basePrompt}\n\n【代码语言】用户当前的代码是 ${LANG_LABEL[detected]}。` +
      `所有代码示例（尤其是修复示例）必须使用 ${LANG_LABEL[detected]}，不要换成其他语言。`
    : basePrompt;

  const payloadMessages = [
    {
      role: "system" as const,
      content: finalSystemPrompt,
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
  // 薄弱点分析结果：以弹窗形式独立展示，不进入任一模式的对话流。
  // error 用于生成失败/停止时的提示，生成期间保留旧 content，新结果完成才替代
  const [weakness, setWeakness] = useState<{
    id: string;
    content: string;
    isLoading: boolean;
    error?: string;
  } | null>(null);
  // 弹窗打开状态与内容分离：关闭后保留上一次分析，再次打开仍可看到旧结果
  const [weaknessOpen, setWeaknessOpen] = useState(false);

  const scrollRefs = useRef<Partial<Record<ModeId, HTMLDivElement | null>>>({});
  const abortRef = useRef<AbortController | null>(null);
  const weaknessAbortRef = useRef<AbortController | null>(null);
  // 代码区（Monaco）滚动控制句柄，用于与 AI 回答区同步滚动
  const codeEditorRef = useRef<CodeEditorHandle | null>(null);
  // 同步滚动时的防抖锁：程序性滚动触发的事件跳过，避免互相回写造成抖动
  const syncingRef = useRef(false);
  // 用户是否已主动离开底部向上浏览：为 true 时生成新内容不再强拉回底部，
  // 让用户在 AI 生成期间可以自由浏览回答区
  const userScrolledAwayRef = useRef(false);

  // 有任一模式正在生成即视为 isThinking（沿用历史逻辑）
  const isThinking = generatingMode !== null;
  // 当前模式的消息（渲染当前 AI 回答框）：仅当前会话，打开页面时为空
  const messages = messagesByMode[mode] ?? [];
  // 跨会话持久化归档的历史：localStorage 只保存这份，回答区不恢复旧对话
  const [historyByMode, setHistoryByMode] = useState<
    Record<ModeId, ChatMessage[]>
  >(() => emptyMessages());
  // 全部历史合并（历史记录面板、薄弱点分析、顶部计数用）：
  // 跨会话持久化归档，打开页面时旧对话只留在历史记录里
  const allMessages = Object.values(historyByMode).flat();

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

  /** 向指定模式追加消息：回答区（当前会话）与历史归档（持久化）同步追加 */
  function appendToMode(modeId: ModeId, items: ChatMessage[]) {
    // 回答区：只保留本次打开页面后的当前会话
    setMessagesByMode((prev) => ({
      ...prev,
      [modeId]: [...prev[modeId], ...items],
    }));
    // 历史归档：跨会话累积，全局最多保留 100 条
    setHistoryByMode((prev) =>
      pruneAll({ ...prev, [modeId]: [...prev[modeId], ...items] }),
    );
  }

  /** 流式更新指定模式里某条助手消息的内容（回答区与历史归档同步） */
  function patchAssistant(modeId: ModeId, id: string, content: string) {
    const upd = (prev: Record<ModeId, ChatMessage[]>) => ({
      ...prev,
      [modeId]: prev[modeId].map((m) => (m.id === id ? { ...m, content } : m)),
    });
    setMessagesByMode(upd);
    setHistoryByMode(upd);
  }

  // ---------- 代码区与 AI 回答区同步滚动 ----------

  /** 当前模式 AI 回答框的滚动容器 */
  function activeAnswerEl(): HTMLDivElement | null {
    return scrollRefs.current[mode] ?? null;
  }

  /** 代码区可滚动高度（0 表示内容不满一屏，无需滚动） */
  function codeMaxScroll(): number {
    const ed = codeEditorRef.current;
    if (!ed) return 0;
    return Math.max(ed.getScrollHeight() - ed.getLayoutInfo().height, 0);
  }

  /** 按滚动比例同步：代码区 → AI 回答区 */
  function handleCodeScroll(e: { scrollTop: number }) {
    if (syncingRef.current) return;
    const target = activeAnswerEl();
    if (!target) return;
    const cMax = codeMaxScroll();
    if (cMax <= 0) return;
    const aMax = Math.max(target.scrollHeight - target.clientHeight, 0);
    if (aMax <= 0) return;
    const ratio = Math.min(Math.max(e.scrollTop / cMax, 0), 1);
    syncingRef.current = true;
    target.scrollTop = ratio * aMax;
    syncingRef.current = false;
  }

  /** 按滚动比例同步：AI 回答区 → 代码区 */
  function handleAnswerScroll() {
    if (syncingRef.current) return;
    const source = activeAnswerEl();
    const ed = codeEditorRef.current;
    if (!source || !ed) return;
    // 记录用户浏览位置：离开底部视为主动向上浏览，生成时不再强拉回底部
    userScrolledAwayRef.current =
      source.scrollHeight - source.scrollTop - source.clientHeight > 60;
    const aMax = Math.max(source.scrollHeight - source.clientHeight, 0);
    if (aMax <= 0) return;
    const ratio = Math.min(Math.max(source.scrollTop / aMax, 0), 1);
    const cMax = codeMaxScroll();
    if (cMax <= 0) return;
    syncingRef.current = true;
    ed.setScrollTop(ratio * cMax);
    syncingRef.current = false;
  }

  /** 点击代码行 → 在 AI 回答区定位并滚动到对应行的讲解（锚点「第 N 行」） */
  function scrollAnswerToLine(line: number) {
    const el = activeAnswerEl();
    if (!el) return;
    // 在回答区查找包含「第 N 行」的讲解块（标题/段落/列表项）
    const targets = el.querySelectorAll("h1,h2,h3,p,li");
    let anchor: Element | null = null;
    for (const t of targets) {
      const text = t.textContent ?? "";
      if (new RegExp(`第\\s*${line}\\s*行`).test(text) && text.length < 200) {
        anchor = t;
        break;
      }
    }
    if (!anchor) return;
    // 跳转后视为用户离开底部，生成中不再被拉回；锁住避免与同步滚动互相回写
    userScrolledAwayRef.current = true;
    syncingRef.current = true;
    el.scrollTop =
      anchor.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop -
      8;
    syncingRef.current = false;
  }

  const activeMode = MODES.find((item) => item.id === mode) ?? MODES[0];

  // 页面加载时从localStorage恢复「历史归档」到 historyByMode，
  // 不恢复到回答区（messagesByMode 保持空，回答区每次打开都是全新的会话）
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
          setHistoryByMode(grouped);
        } else if (parsed && typeof parsed === "object") {
          const restored = emptyMessages();
          for (const k of Object.keys(restored) as ModeId[]) {
            const arr = (parsed as Record<string, unknown>)[k];
            if (Array.isArray(arr)) restored[k] = arr as ChatMessage[];
          }
          setHistoryByMode(restored);
        }
      }
    } catch {
      // 数据损坏则忽略
    }
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 历史归档变化时保存到localStorage（全局最多保留100条）
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(historyByMode));
    } catch {
      // 存储满则忽略
    }
  }, [historyByMode, loaded]);

  // 正在生成的模式（或当前模式）有新内容时，回答框与代码区同步滚动到底部。
  // 生成中若用户已主动向上浏览（userScrolledAwayRef），则不再强拉回底部，方便自由浏览；
  // 非生成场景（模式切换等）始终跟随。
  useEffect(() => {
    if (userScrolledAwayRef.current && generatingMode) return;
    const target = generatingMode ?? mode;
    const el = scrollRefs.current[target];
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const ed = codeEditorRef.current;
    if (ed) {
      syncingRef.current = true;
      ed.setScrollTop(ed.getScrollHeight());
      syncingRef.current = false;
    }
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
    // 新一轮对话：重置浏览标记，让回答区跟随到最新内容
    userScrolledAwayRef.current = false;

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
      // 用户主动中断：保留已生成内容，追加停止提示（回答区与历史归档同步）
      if (err instanceof DOMException && err.name === "AbortError") {
        const stopUpd = (prev: Record<ModeId, ChatMessage[]>) => ({
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
        });
        setMessagesByMode(stopUpd);
        setHistoryByMode(stopUpd);
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
        // 代码保留在左侧编辑框，不重复出现在右侧回答区
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

    // 代码保留在左侧编辑框：右侧回答区只显示 AI 的分析，不再重复展示用户代码
    await runTurn({
      userBubbleContent: content,
      payloadContent: finalContent,
      history,
    });
  }

  // 「分析薄弱点」：基于历史记录做个性化分析。
  /** 收集用于薄弱点分析的历史对话（最近 10 条有意义的消息），无历史时返回 null */
  function weaknessHistory(): string | null {
    const meaningful = allMessages
      .filter(
        (m) =>
          m.content.trim() !== "" &&
          !m.content.startsWith("> ⚠️") &&
          !m.content.startsWith("> （"),
      )
      .slice(-10);
    if (meaningful.length === 0) return null;
    const historyText = meaningful
      .map(
        (m) =>
          `【${m.role === "user" ? "学生" : "AI 助手"} · ${MODE_LABEL[m.mode]}】\n${m.content}`,
      )
      .join("\n\n---\n\n");
    return `【分析请求】\n📊 请根据我们的历史对话，分析我的薄弱环节并给出改进建议\n\n【我的历史对话记录】\n${historyText}\n\n请基于以上记录做个性化薄弱点分析。`;
  }

  /** 打开薄弱点弹窗：保留上一次的分析结果，不自动重新生成 */
  function handleAnalyzeWeakness() {
    if (isThinking || weakness?.isLoading) return;
    if (weaknessHistory() === null) {
      setNotice("还没有足够的历史对话，先发几条消息再来分析吧");
      return;
    }
    // 首次打开时初始化空的分析记录（显示空态，提示点击「生成」）
    if (!weakness) {
      setWeakness({ id: crypto.randomUUID(), content: "", isLoading: false });
    }
    setWeaknessOpen(true);
  }

  /** 生成新的薄弱点分析：后台完整生成。生成期间保留旧分析可见，新结果完成才替代 */
  async function handleGenerateWeakness() {
    if (weakness?.isLoading) return;
    const payloadContent = weaknessHistory();
    if (payloadContent === null) {
      setNotice("还没有足够的历史对话，先发几条消息再来分析吧");
      return;
    }

    const id = crypto.randomUUID();
    // 生成前是否已有旧分析：用于停止时决定提示文案（保留旧分析 or 无内容）
    const hadContent = Boolean(weakness?.content?.trim());
    // 只标记「生成中」，不清空旧 content：新分析完成后才替代旧的分析
    setWeakness((cur) => ({
      id,
      content: cur?.content ?? "",
      isLoading: true,
      error: undefined,
    }));
    setWeaknessOpen(true);

    const controller = new AbortController();
    weaknessAbortRef.current = controller;

    // 成功结果：一次性写入 content，替代旧分析并清空错误提示
    const apply = (content: string) => {
      setWeakness((cur) =>
        cur ? { ...cur, content, error: undefined } : cur,
      );
    };
    // 失败/停止：保留旧 content，把提示放到 error 字段
    const fail = (error: string) => {
      setWeakness((cur) => (cur ? { ...cur, error } : cur));
    };

    try {
      const result = await streamChat(
        mode,
        payloadContent,
        [],
        controller.signal,
        // 后台完整生成：流式增量只累积、不逐字渲染到前端，完成后一次性显示
        () => {},
        modelConfig,
        WEAKNESS_ANALYSIS_PROMPT,
      );

      if (!result.ok) {
        fail(`⚠️ 请求失败：${result.error}`);
      } else if (!result.content) {
        fail("⚠️ 模型没有返回内容，请重试");
      } else {
        apply(result.content);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        fail(hadContent ? "已停止生成，保留原有分析" : "已停止分析");
      } else {
        fail(
          `⚠️ 网络错误：${err instanceof Error ? err.message : "未知错误"}`,
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

  // 跨所有模式查找并删除指定消息（回答区与历史归档同步）
  function handleDeleteMessage(id: string) {
    const del = (prev: Record<ModeId, ChatMessage[]>) => {
      const next: Record<ModeId, ChatMessage[]> = { ...prev };
      for (const k of Object.keys(next) as ModeId[]) {
        if (next[k].some((m) => m.id === id)) {
          next[k] = next[k].filter((m) => m.id !== id);
        }
      }
      return next;
    };
    setMessagesByMode(del);
    setHistoryByMode(del);
  }

  // 跨所有模式查找并编辑指定消息内容（回答区与历史归档同步）
  function handleEditMessage(id: string, content: string) {
    const edit = (prev: Record<ModeId, ChatMessage[]>) => {
      const next: Record<ModeId, ChatMessage[]> = { ...prev };
      for (const k of Object.keys(next) as ModeId[]) {
        if (next[k].some((m) => m.id === id)) {
          next[k] = next[k].map((m) => (m.id === id ? { ...m, content } : m));
        }
      }
      return next;
    };
    setMessagesByMode(edit);
    setHistoryByMode(edit);
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
              onReady={(handle) => {
                codeEditorRef.current = handle;
                handle.onDidScrollChange(handleCodeScroll);
                // 点击代码行 → 回答区跳转到对应行的讲解
                handle.onDidChangeCursorPosition(scrollAnswerToLine);
              }}
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
          // 回答框只展示 AI 回答，用户代码只保留在左侧编辑框
          const visible = msgs.filter((m) => m.role === "assistant");
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
                    {visible.length} 条回答
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      // 清空当前模式：回答区与历史归档一起清
                      setMessagesByMode((prev) => ({ ...prev, [item.id]: [] }));
                      setHistoryByMode((prev) => ({ ...prev, [item.id]: [] }));
                    }}
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
                onScroll={handleAnswerScroll}
                className="scroll-area flex-1 space-y-4 overflow-y-auto px-4 py-4"
              >
                {visible.length === 0 && !thinking ? (
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

                {visible.map((message) => (
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
                ))}

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

      {weaknessOpen && weakness ? (
        <WeaknessAnalysis
          id={weakness.id}
          content={weakness.content}
          isLoading={weakness.isLoading}
          onGenerate={handleGenerateWeakness}
          onClose={() => {
            // 只关闭弹窗，保留上一次分析内容，下次打开仍可见
            weaknessAbortRef.current?.abort();
            setWeaknessOpen(false);
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
