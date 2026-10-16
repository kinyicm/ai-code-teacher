"use client";

import { useEffect } from "react";
import { KNOWLEDGE } from "@/lib/errorKnowledge";
import type { LangId } from "@/lib/languageDetect";

interface ErrorHandbookProps {
  onClose: () => void;
  onPick: (lang: LangId, code: string) => void;
}

/** 语言 id → 显示名 */
const LANG_SHOW: Record<LangId, string> = {
  java: "Java",
  python: "Python",
  javascript: "JavaScript",
  c: "C",
  cpp: "C++",
};

/**
 * 错误手册弹窗：展示四种常见代码错误类型（语法/编译/运行时/逻辑），
 * 点击卡片把修复示例填入输入区，供离线练习。
 */
export default function ErrorHandbook({ onClose, onPick }: ErrorHandbookProps) {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="错误手册"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-zinc-100">
            📚 错误手册 · 离线知识库
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕ 关闭
          </button>
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-[12px] text-zinc-500">
            四种常见代码错误类型已内置前端，断网也能识别和讲解。点击卡片把示例代码填入输入区，可切到「找
            Bug」模式直接发送体验。
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {KNOWLEDGE.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => onPick(k.fixExample.lang, k.fixExample.code)}
                className="group flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 text-left transition-colors hover:border-emerald-500/40 hover:bg-zinc-900"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{k.icon}</span>
                  <span className="text-[14px] font-semibold text-zinc-100">
                    {k.name}
                  </span>
                </div>
                <p className="line-clamp-2 text-[12px] leading-relaxed text-zinc-400">
                  {k.plainExplanation}
                </p>
                <pre className="scroll-area max-h-24 overflow-hidden font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-emerald-200/80">
                  {k.fixExample.code.slice(0, 220)}
                </pre>
                <span className="text-[11px] text-emerald-400/90 transition-colors group-hover:text-emerald-300">
                  填入示例（{LANG_SHOW[k.fixExample.lang]}）→
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
