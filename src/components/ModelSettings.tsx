"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_MODEL_CONFIG,
  validateCustomBaseUrl,
  type ModelConfig,
} from "@/lib/modelConfig";

interface ModelSettingsProps {
  current: ModelConfig;
  onSave: (config: ModelConfig) => void;
  onClose: () => void;
}

/**
 * 模型设置弹窗：选择默认智谱大模型，或粘贴自定义的 OpenAI 兼容 API。
 */
export default function ModelSettings({
  current,
  onSave,
  onClose,
}: ModelSettingsProps) {
  const [source, setSource] = useState<"default" | "custom">(current.source);
  const [baseUrl, setBaseUrl] = useState(current.baseUrl);
  const [apiKey, setApiKey] = useState(current.apiKey);
  const [model, setModel] = useState(current.model);
  const [error, setError] = useState("");

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSave() {
    if (source === "custom") {
      if (!baseUrl.trim()) {
        setError("请填写接口地址（如 https://api.deepseek.com/v1/chat/completions）");
        return;
      }
      if (!apiKey.trim()) {
        setError("请粘贴你的 API Key");
        return;
      }
      const urlErr = validateCustomBaseUrl(baseUrl);
      if (urlErr) {
        setError(`接口地址无效：${urlErr}`);
        return;
      }
      // 模型名必填：各家服务商的模型名互不相同，留空若回落到默认值（glm-4-flash），
      // 发给 OpenAI / DeepSeek 只会得到一个看不懂的上游报错。
      if (!model.trim()) {
        setError(
          "请填写模型名 —— 各服务商不同，例如 gpt-4o-mini / deepseek-chat / glm-4-flash",
        );
        return;
      }
    }
    setError("");
    onSave({
      source,
      baseUrl: source === "custom" ? baseUrl.trim() : "",
      apiKey: source === "custom" ? apiKey.trim() : "",
      model: source === "custom" ? model.trim() : "",
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="模型设置"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-zinc-100">
            ⚙️ 模型设置
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕ 关闭
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* 选择来源 */}
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 transition-colors hover:border-emerald-500/40">
              <input
                type="radio"
                name="model-source"
                checked={source === "default"}
                onChange={() => {
                  setSource("default");
                  setError("");
                }}
                className="mt-1 accent-emerald-500"
              />
              <span>
                <span className="block text-[13px] font-medium text-zinc-200">
                  默认智谱大模型（glm-4-flash）
                </span>
                <span className="block text-[11px] text-zinc-500">
                  无需任何配置，直接使用内置的智谱 AI
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 transition-colors hover:border-violet-500/40">
              <input
                type="radio"
                name="model-source"
                checked={source === "custom"}
                onChange={() => {
                  setSource("custom");
                  setError("");
                }}
                className="mt-1 accent-violet-500"
              />
              <span>
                <span className="block text-[13px] font-medium text-zinc-200">
                  自定义 API（OpenAI 兼容）
                </span>
                <span className="block text-[11px] text-zinc-500">
                  可接入 OpenAI / DeepSeek / Kimi / 阿里云百炼 等兼容服务（仅限白名单域名）
                </span>
              </span>
            </label>
          </div>

          {/* 自定义配置 */}
          {source === "custom" ? (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-[12px] text-zinc-400">
                  接口地址（Base URL）
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setError("");
                  }}
                  placeholder="https://api.openai.com/v1/chat/completions"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] text-zinc-400">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setError("");
                  }}
                  placeholder="sk-..."
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-violet-500/60"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Key 保存在浏览器本地，仅发送给本站代理接口，不会展示或外传
                </p>
              </div>
              <div>
                <label className="mb-1 block text-[12px] text-zinc-400">
                  模型名
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setError("");
                  }}
                  placeholder="gpt-4o-mini / glm-4-flash ..."
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-violet-500/60"
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-[12px] text-rose-400">{error}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => {
                setSource("default");
                setBaseUrl("");
                setApiKey("");
                setModel("");
                setError("");
                onSave({ ...DEFAULT_MODEL_CONFIG });
                onClose();
              }}
              className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-violet-500 px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-violet-600"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
