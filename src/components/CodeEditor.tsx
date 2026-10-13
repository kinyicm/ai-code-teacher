"use client";

import Editor from "@monaco-editor/react";

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
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            加载编辑器…
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
