"use client";

import { useEffect, useState } from "react";
import MarkdownMessage from "@/components/MarkdownMessage";

interface WeaknessAnalysisProps {
  id: string;
  content: string;
  isLoading: boolean;
  onClose: () => void;
  onStop: () => void;
}

/**
 * 薄弱点分析弹窗：基于历史对话的个性化薄弱点分析，独立于 AI 回答区的对话流，
 * 以模态浮层形式展示（与「错误手册」交互一致）。
 */
export default function WeaknessAnalysis({
  id,
  content,
  isLoading,
  onClose,
  onStop,
}: WeaknessAnalysisProps) {
  const [copied, setCopied] = useState(false);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时忽略
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="薄弱点分析"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-amber-500/30 bg-zinc-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-amber-500/20 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-amber-300">
            📊 薄弱点分析
          </h3>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
              >
                停止分析
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleCopy}
              disabled={!content.trim()}
              className="text-sm text-amber-300/70 transition-colors hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? "已复制 ✓" : "复制"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              ✕ 关闭
            </button>
          </div>
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto p-4">
          {content.trim() ? (
            <MarkdownMessage content={content} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-amber-200/70">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              正在结合你的历史对话分析薄弱点…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
