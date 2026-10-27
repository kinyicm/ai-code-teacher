/**
 * 离线错误知识库：四种常见代码错误类型
 * （语法错误 / 编译错误 / 运行时错误 / 逻辑错误）
 * 写入前端，使「找 Bug」模式在无网络时也能本地识别并解答，不依赖 AI API。
 */

import { parseJavaError } from "@/lib/errorParser";
import type { LangId } from "@/lib/languageDetect";

export type ErrorTypeId = "syntax" | "compile" | "runtime" | "logic";

export interface ErrorKnowledge {
  id: ErrorTypeId;
  name: string; // 中文名
  icon: string; // emoji 图标
  plainExplanation: string; // 零基础通俗解释
  scenarios: string[]; // 常见触发场景
  debugSteps: string[]; // 排查思路步骤
  fixExample: { lang: LangId; code: string }; // 典型修复示例
  practiceHint?: string; // 练习提示
}

export const KNOWLEDGE: ErrorKnowledge[] = [
  {
    id: "syntax",
    name: "语法错误",
    icon: "🧩",
    plainExplanation:
      "代码的「语法格式」写错了，编译器或解释器根本看不懂。就像中文句子语序颠倒、缺了标点，读起来莫名其妙。常见原因：括号没配对、语句末尾少分号、Python 缩进不一致、引号没闭合。",
    scenarios: [
      "少了右括号 / 大括号，或括号不配对",
      "Java / C 语句末尾漏写分号（;）",
      "Python 缩进不一致（Tab 和空格混用）",
      "字符串引号 / 注释没有闭合",
    ],
    debugSteps: [
      "先看报错提示里的行号，定位到出错的那一行",
      "从出错行往前数括号：( ) [ ] { } 是否一一配对",
      "检查每一条语句末尾是否都有分号（Python 不需要）",
      "Python 重点检查缩进是否统一（全部用 4 个空格）",
    ],
    fixExample: {
      lang: "java",
      code: `public class Main {
    public static void main(String[] args) {
        int a = 5;          // 每条语句末尾要有分号
        System.out.println(a);   // 括号要配对闭合
    }
}`,
    },
    practiceHint: "故意删掉一个右括号或分号，先自己找出错误，再对照修复示例。",
  },
  {
    id: "compile",
    name: "编译错误",
    icon: "⚙️",
    plainExplanation:
      "代码能「拼」出来，但编译时发现引用了不存在的东西，或类型对不上。就像点名时喊了班里没有的同学。常见原因：变量/方法没声明就用、方法名拼错、类型不匹配、C/C++ 缺少库文件。",
    scenarios: [
      "使用了没声明过的变量或方法（Java: cannot find symbol）",
      "调用了不存在或拼写错误的方法",
      "类型不匹配（把字符串当数字用）",
      "C/C++ 链接时找不到函数实现（undefined reference）",
    ],
    debugSteps: [
      "检查报错里的名字是否拼写正确、是否已声明",
      "确认变量 / 方法的类型和用法是否一致",
      "Java 检查 import 是否齐全；C/C++ 检查是否链接了对应的库",
      "把报错信息里的关键字（如符号名）复制到手册里对比",
    ],
    fixExample: {
      lang: "c",
      code: `#include <stdio.h>

int main(void) {
    int num = 10;
    printf("num = %d\\n", num);   // %d 和 int 类型匹配
    return 0;
}`,
    },
    practiceHint: "试试引用一个从未声明过的变量，观察编译器给出的英文报错，学着自己读懂它。",
  },
  {
    id: "runtime",
    name: "运行时错误",
    icon: "💥",
    plainExplanation:
      "程序能编译、能启动，但运行到某一步时崩溃了（抛异常）。就像车能开，但开到半路爆了胎。常见原因：除以 0、数组下标越界、空指针、文件不存在、类型转换失败。",
    scenarios: [
      "数组 / 列表下标越界（ArrayIndexOutOfBoundsException）",
      "除数为 0（ArithmeticException）",
      "空指针：调用了 null 对象的方法（NullPointerException）",
      "把不是数字的字符串转成数字（NumberFormatException）",
      "Python / JS 中变量未定义、键不存在（NameError / KeyError）",
    ],
    debugSteps: [
      "找到报错信息里的「出错位置」行号，先定位到那一行",
      "看异常类型的通俗解释（Java 异常手册会自动翻译）",
      "检查那一行用到的变量：是否为 null、下标是否越界",
      "先修复出错的那一行，再运行看是否还有下一个错误",
    ],
    fixExample: {
      lang: "java",
      code: `public class Main {
    public static void main(String[] args) {
        int[] arr = {1, 2, 3};
        for (int i = 0; i < arr.length; i++) {  // 用 < 而不是 <=，避免越界
            System.out.println(arr[i]);
        }
    }
}`,
    },
    practiceHint: "故意把下标写成 arr[3]，运行看抛出的异常，学着自己读懂堆栈信息。",
  },
  {
    id: "logic",
    name: "逻辑错误",
    icon: "🧠",
    plainExplanation:
      "代码能跑、不报错，但结果不对。就像把「先穿袜子再穿鞋」的步骤写反了——每一步单独看都对，合起来结果就是不对。这类错误最难找，因为程序不会提醒你。",
    scenarios: [
      "循环条件写错：少跑一遍或多跑一遍（边界问题）",
      "比较写成赋值：if (x = 1) 而不是 if (x == 1)",
      "比较符号方向写反（< 写成 >）",
      "while 循环条件恒为 true，忘记写跳出条件（死循环）",
    ],
    debugSteps: [
      "在关键位置加打印输出（print / console.log），看中间值是什么",
      "逐个检查比较符号的方向：>=、<=、== 是否用对",
      "检查循环边界：length 是下标上限，i < length 才是最后一次合法下标",
      "把结果和手算的期望值对比，缩小出错范围",
    ],
    fixExample: {
      lang: "java",
      code: `int[] arr = {10, 20, 30};
// 用 i < arr.length 而不是 i <= arr.length：
// 后者会多访问一次，第 4 次取 arr[3] 直接抛数组越界
for (int i = 0; i < arr.length; i++) {
    System.out.println(arr[i]);
}`,
    },
    practiceHint: "把循环条件改成 i <= arr.length，看看多出的那一行输出是什么。",
  },
];

/** 编译错误强特征关键词 */
const COMPILE_KEYWORDS_RE =
  /cannot find symbol|undefined reference|undeclared identifier|incompatible types|no matching function|does not exist|compilation error|编译错误|编译失败/;

/** 语法错误强特征关键词 */
const SYNTAX_KEYWORDS_RE =
  /SyntaxError|invalid syntax|unexpected token|语法错误|missing closing|unterminated string|unterminated comment/;

/** 非 Java 运行时异常的强特征（异常名后紧跟冒号，符合报错输出格式） */
const RUNTIME_KEYWORDS_RE =
  /\b(?:ZeroDivisionError|TypeError|NameError|IndexError|KeyError|AttributeError|ValueError|ReferenceError|RangeError)\s*[:：]/;

/** Python 回溯头 */
const PYTHON_TRACEBACK_RE = /Traceback\s*\(most recent call last\)/;

/** 逻辑错误弱规则 */
const LOGIC_RULES: { re: RegExp; reason: string }[] = [
  {
    re: /while\s*\(\s*(?:true|1)\s*\)/,
    reason: "死循环：while 条件恒为 true，且循环体内缺少跳出条件（break）",
  },
  {
    re: /if\s*\(\s*\w+\s*=\s*[^=\s]/,
    reason: "比较误写成赋值：if 条件里用了 =（赋值）而不是 ==（比较）",
  },
  {
    re: /for\s*\([^)]*\b\w+\s*<=\s*\w*\.length\b/,
    reason: "循环边界越界：for 条件用了 <= length，会多访问一次（应使用 < length）",
  },
];

/** 输入是否像代码（用于给弱规则加保险，避免误判普通描述文字） */
function isCodeLike(input: string): boolean {
  if (input.length < 10) return false;
  const symbols = input.match(/[{}\[\]();=<>+\-*/%!]/g);
  return (symbols?.length ?? 0) >= 4 || /```/.test(input);
}

/** 统计某类括号是否配对（返回值非 0 表示不配对） */
function unbalancedCount(input: string, open: string, close: string): number {
  let n = 0;
  for (const ch of input) {
    if (ch === open) n++;
    else if (ch === close) n--;
  }
  return n;
}

export interface OfflineMatch {
  type: ErrorTypeId;
  reason: string;
  lang: LangId | null;
}

/**
 * 本地识别四种常见代码错误类型。
 * 检测顺序：运行时 → 编译 → 语法 → 逻辑；未命中返回 null。
 * 语法 / 逻辑为弱规则，需要「代码特征 + 多规则命中」才能判定，防止误报。
 */
export function classifyError(input: string): OfflineMatch | null {
  const text = input.trim();
  if (text.length < 10) return null;

  // 1. 运行时错误：Java 异常堆栈，或其他语言的运行时异常特征
  const parsed = parseJavaError(text);
  if (parsed.isJavaStack && parsed.exceptionSimple) {
    return {
      type: "runtime",
      reason: `Java 抛出了 ${parsed.exceptionSimple}（${parsed.summary}）`,
      lang: "java",
    };
  }
  if (RUNTIME_KEYWORDS_RE.test(text)) {
    return {
      type: "runtime",
      reason: "检测到运行时异常关键字（如 TypeError / ZeroDivisionError 等）",
      lang: null,
    };
  }
  if (PYTHON_TRACEBACK_RE.test(text)) {
    return { type: "runtime", reason: "检测到 Python 异常回溯（Traceback）", lang: "python" };
  }

  // 2. 编译错误：强特征关键词
  const compileHit = text.match(COMPILE_KEYWORDS_RE);
  if (compileHit) {
    return {
      type: "compile",
      reason: `检测到编译错误特征：${compileHit[0]}`,
      lang: /cannot find symbol|incompatible types/.test(text) ? "java" : null,
    };
  }

  // 3. 语法错误：强关键词，或代码特征下括号不配对
  const syntaxKeyword = text.match(SYNTAX_KEYWORDS_RE);
  if (syntaxKeyword) {
    return {
      type: "syntax",
      reason: `检测到语法错误特征：${syntaxKeyword[0]}`,
      lang: null,
    };
  }
  const codeLike = isCodeLike(text);
  if (codeLike) {
    const unbalanced = [
      unbalancedCount(text, "{", "}"),
      unbalancedCount(text, "(", ")"),
      unbalancedCount(text, "[", "]"),
    ].filter((n) => n !== 0);
    if (unbalanced.length >= 2 || (unbalanced.length === 1 && /```/.test(text))) {
      return {
        type: "syntax",
        reason: `检测到括号不配对（${unbalanced.join(", ")}）`,
        lang: null,
      };
    }
  }

  // 4. 逻辑错误：弱规则，要求多规则命中或代码特征
  const logicHits = LOGIC_RULES.filter((r) => r.re.test(text));
  if (logicHits.length >= 2 || (logicHits.length === 1 && codeLike)) {
    return {
      type: "logic",
      reason: logicHits.map((r) => r.reason).join("；"),
      lang: null,
    };
  }

  return null;
}

/**
 * 根据知识库条目生成本地 Markdown 解答（标注离线来源）。
 */
export function buildOfflineAnswer(
  k: ErrorKnowledge,
  reason: string,
  lang: LangId | null,
): string {
  const lines: string[] = [];
  lines.push(`## ${k.icon} 识别为「${k.name}」`);
  lines.push("");
  lines.push(`> 离线解答 · 未调用 AI\n`);
  lines.push(`**识别依据**\n\n${reason}\n`);
  lines.push(`**这叫什么错？**\n\n${k.plainExplanation}\n`);
  lines.push("**常见触发场景**\n");
  for (const s of k.scenarios) lines.push(`- ${s}`);
  lines.push("");
  lines.push("**排查思路**\n");
  k.debugSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");
  lines.push(`**修复示例（${k.fixExample.lang === "cpp" ? "C++" : k.fixExample.lang === "javascript" ? "JavaScript" : k.fixExample.lang === "python" ? "Python" : k.fixExample.lang.toUpperCase()}）**\n`);
  lines.push(`\`\`\`${k.fixExample.lang}`);
  lines.push(k.fixExample.code);
  lines.push("```");
  if (k.practiceHint) {
    lines.push("");
    lines.push(`> 💡 练习建议：${k.practiceHint}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("_离线解答 · 未调用 AI_");
  return lines.join("\n");
}
