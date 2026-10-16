"use client";

import { useEffect, useMemo, useState } from "react";
import { MODE_LABEL, type ModeId } from "@/lib/modes";
import {
  LANGUAGES,
  LANG_LABEL,
  detectLanguage,
  type LangId,
} from "@/lib/languageDetect";

export interface HistoryRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: ModeId;
  time?: string;
}

interface HistoryPanelProps {
  records: HistoryRecord[];
  onDelete: (id: string) => void;
  onEdit: (id: string, content: string) => void;
  onClose: () => void;
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function preview(content: string, max = 80): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export default function HistoryPanel({
  records,
  onDelete,
  onEdit,
  onClose,
}: HistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState<"all" | LangId>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 每条记录的语言（从内容检测，无法识别为 null）
  const langOf = useMemo(() => {
    const map = new Map<string, LangId | null>();
    for (const r of records) map.set(r.id, detectLanguage(r.content));
    return map;
  }, [records]);

  // 各语言记录数量，用于分类统计
  const langCounts = useMemo(() => {
    const counts = new Map<LangId, number>();
    for (const r of records) {
      const lang = langOf.get(r.id);
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    return counts;
  }, [records, langOf]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (q && !r.content.toLowerCase().includes(q)) return false;
      if (langFilter !== "all" && langOf.get(r.id) !== langFilter) return false;
      return true;
    });
  }, [records, query, langFilter, langOf]);

  function startEdit(record: HistoryRecord) {
    setEditingId(record.id);
    setDraft(record.content);
  }

  function saveEdit() {
    if (editingId === null || draft.trim() === "") return;
    onEdit(editingId, draft.trim());
    setEditingId(null);
    setDraft("");
  }

  function requestDelete(id: string) {
    setConfirmingId((cur) => (cur === id ? null : id));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="历史记录"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">历史记录</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              共 {records.length} / 100 条，编辑或删除后自动保存
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            关闭
          </button>
        </div>

        {/* 搜索 */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索历史记录内容…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500/60"
          />
        </div>

        {/* 语言筛选 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
          <span className="mr-0.5 text-[11px] text-zinc-500">语言</span>
          <button
            type="button"
            onClick={() => setLangFilter("all")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              langFilter === "all"
                ? "bg-indigo-500 text-white"
                : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            全部 {records.length}
          </button>
          {LANGUAGES.map((lang) => {
            const n = langCounts.get(lang.id) ?? 0;
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => setLangFilter(lang.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  langFilter === lang.id
                    ? "bg-indigo-500 text-white"
                    : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {lang.label} {n > 0 ? n : ""}
              </button>
            );
          })}
        </div>

        {/* 列表 */}
        <div className="scroll-area min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {records.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              暂无历史记录
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              {query.trim()
                ? `没有匹配「${query.trim()}」的记录`
                : "没有该语言的记录"}
            </p>
          ) : (
            filtered.map((record) => {
              const isEditing = editingId === record.id;
              const recordLang = langOf.get(record.id);
              return (
                <div
                  key={record.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${
                        record.role === "user"
                          ? "bg-indigo-500/15 text-indigo-300"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {record.role === "user" ? "你的输入" : "AI 回答"}
                    </span>
                    <span className="text-zinc-500">
                      {MODE_LABEL[record.mode]}
                    </span>
                    {recordLang ? (
                      <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-medium text-zinc-400">
                        {LANG_LABEL[recordLang]}
                      </span>
                    ) : null}
                    <span className="ml-auto text-zinc-600">
                      {formatTime(record.time)}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        autoFocus
                        className="w-full resize-y rounded-md border border-indigo-500/40 bg-zinc-950 px-2.5 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={draft.trim() === ""}
                          className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p
                        className={`line-clamp-3 text-[13px] leading-relaxed ${
                          record.role === "user"
                            ? "font-mono text-zinc-100"
                            : "text-zinc-300"
                        }`}
                      >
                        {preview(record.content) || "（空内容）"}
                      </p>
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          className="text-[11px] text-zinc-500 transition-colors hover:text-indigo-300"
                        >
                          编辑
                        </button>
                        {confirmingId === record.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDelete(record.id);
                              setConfirmingId(null);
                            }}
                            className="text-[11px] font-medium text-red-400 transition-colors hover:text-red-300"
                          >
                            确认删除？
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => requestDelete(record.id)}
                            className="text-[11px] text-zinc-500 transition-colors hover:text-red-400"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
