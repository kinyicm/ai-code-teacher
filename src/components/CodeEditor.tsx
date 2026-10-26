"use client";

import Editor, { loader } from "@monaco-editor/react";

// 将 Monaco 界面本地化为中文（右键菜单里的复制/剪切/粘贴、命令面板等）。
// 必须在编辑器加载前设置；@monaco-editor/react 默认从 CDN 加载 monaco。
//
// 为什么用国内镜像而不是官方默认的 jsDelivr：
// monaco 的 editor.main.js 约 3.6 MB，是整个应用体积的数倍，首屏能不能快速出现
// 编辑器几乎全取决于这一个文件的下拉速度。实测同一环境：
//   jsDelivr  约 507 ms
//   npmmirror 约 164 ms（且国内长期稳定）
// 若你的使用环境在海外，可以把下面的 vs 改回：
//   https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs
//
// 版本固定为 0.52.2：0.55.1 的 min 包里 zh-cn 翻译文件打包异常（文件名和模块 id
// 都多了一个 .js 后缀），会导致中文语言包 404、编辑器无法初始化。
loader.config({
  paths: {
    vs: "https://registry.npmmirror.com/monaco-editor/0.52.2/files/min/vs",
  },
  "vs/nls": {
    availableLanguages: { "*": "zh-cn" },
  },
});

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  onSubmit?: () => void;
  placeholder?: string;
}

export default function CodeEditor({
  value,
  onChange,
  language = "java",
  onSubmit,
  placeholder,
}: CodeEditorProps) {
  function handleMount(editor: {
    addAction: (action: {
      id: string;
      label: string;
      keybindings: number[];
      run: () => void;
    }) => void;
  }) {
    // Ctrl+Enter 发送
    if (onSubmit) {
      editor.addAction({
        id: "submit-code",
        label: "发送代码",
        keybindings: [2048 | 3], // Ctrl + Enter
        run: () => onSubmit(),
      });
    }
  }

  return (
    <div className="relative flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 focus-within:border-indigo-500/60 focus-within:ring-2 focus-within:ring-indigo-500/20">
      <Editor
        value={value}
        language={language}
        theme="vs-dark"
        onChange={(val) => onChange(val ?? "")}
        onMount={handleMount}
        loading={
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500">
            <span>正在加载代码编辑器…</span>
            <span className="text-[11px] text-zinc-600">
              首次打开需下载约 3.6 MB 的编辑器资源，之后会被浏览器缓存
            </span>
          </div>
        }
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily:
            "'Cascadia Code', 'Consolas', 'Courier New', monospace",
          lineNumbers: "on",
          roundedSelection: true,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          wordWrap: "on",
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "all",
          // 关闭自动补全弹窗，避免干扰输入
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
          },
        }}
      />
      {!value && placeholder && (
        <div className="pointer-events-none absolute top-3 left-4 text-[13px] text-zinc-600 whitespace-pre-wrap">
          {placeholder}
        </div>
      )}
    </div>
  );
}
