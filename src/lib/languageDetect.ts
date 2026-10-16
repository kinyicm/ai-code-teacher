/**
 * 代码语言检测：用于历史记录按语言分类筛选。
 * 检测策略：先看 Markdown 代码围栏（```java 等），再用关键词启发式兜底。
 * 历史消息未存语言字段，因此直接从内容识别，旧数据也能生效。
 */

export type LangId = "java" | "python" | "javascript" | "c" | "cpp";

export const LANGUAGES: { id: LangId; label: string }[] = [
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
];

export const LANG_LABEL: Record<LangId, string> = {
  java: "Java",
  python: "Python",
  javascript: "JavaScript",
  c: "C",
  cpp: "C++",
};

/** 代码围栏语言标签的别名归一化 */
const FENCE_ALIASES: Record<string, LangId> = {
  java: "java",
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  ts: "javascript",
  typescript: "javascript",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cxx: "cpp",
};

/** 关键词启发式规则，按特征强度排序（cpp/java 优先，避免与 c 混淆） */
const KEYWORD_RULES: { id: LangId; re: RegExp }[] = [
  {
    id: "cpp",
    re: /\b(std::|#include\s*[<"](?:iostream|vector|string|map|algorithm|memory)|using\s+namespace\s+std|cout\s*<<|cin\s*>>)/,
  },
  {
    id: "java",
    re: /\b(public\s+(?:static\s+)?class\b|public\s+static\s+void\s+main\b|System\.(?:out|err)\.|import\s+java\.|Exception\s+in\s+thread\b|Caused\s+by:|\bat\s+[\w.$/]+\()/,
  },
  {
    id: "c",
    re: /\b(#include\s*[<"](?:stdio\.h|stdlib\.h|string\.h)|int\s+main\s*\(|printf\s*\(|scanf\s*\()/,
  },
  {
    id: "python",
    re: /\b(def\s+\w+\s*\(|print\s*\(|if\s+__name__\s*==|from\s+\w+\s+import\b|import\s+\w+\s+as\b)/,
  },
  {
    id: "javascript",
    re: /\b(console\.log|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|function\s+\w*\s*\(|=>\s*\{|document\.|getElementById|querySelector)/,
  },
];

/**
 * 检测一段文本对应的编程语言；无法识别时返回 null。
 */
export function detectLanguage(content: string): LangId | null {
  if (!content) return null;

  // 1. 优先识别代码围栏，取出现次数最多的语言
  const fenceRe = /```([\w+#-]+)/g;
  const counts = new Map<LangId, number>();
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    const lang = FENCE_ALIASES[m[1].toLowerCase()];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let best: LangId | null = null;
    let bestN = 0;
    for (const [lang, n] of counts) {
      if (n > bestN) {
        best = lang;
        bestN = n;
      }
    }
    return best;
  }

  // 2. 关键词启发式兜底
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(content)) return rule.id;
  }
  return null;
}
