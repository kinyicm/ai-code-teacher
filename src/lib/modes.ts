export type ModeId = "explain" | "debug" | "optimize" | "practice";

export interface ModeDef {
  id: ModeId;
  label: string;
  description: string;
  placeholder: string;
  systemPrompt: string;
}

export const MODES: ModeDef[] = [
  {
    id: "explain",
    label: "逐行讲解",
    description: "逐行拆解代码，解释每一句在做什么",
    placeholder:
      "把要学习的代码粘贴到这里，例如：\n\nfor (let i = 0; i < 5; i++) {\n  console.log(i);\n}",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：逐行讲解。请把用户提供的代码逐行拆解：逐行说明每个变量、语句、控制流的作用，用通俗的生活比喻帮助理解，最后用「关键知识点」小节总结这段代码涉及的核心概念。请用简体中文回答，结构清晰、循序渐进。",
  },
  {
    id: "debug",
    label: "找 Bug",
    description: "根据报错信息或可疑代码，定位错误原因",
    placeholder:
      "粘贴报错信息或可疑代码，例如：\n\nTypeError: Cannot read properties of undefined (reading 'map')\n（只有报错也没关系，我会先请你补充代码）",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：找 Bug。请先判断用户输入：如果只粘贴了报错信息、没有包含任何代码，不要猜测原因，而是先简短请用户补充相关代码（说明需要哪部分代码）；如果用户已提供代码（可能连同报错），请直接分析：定位错误的根本原因，用通俗语言解释为什么会报错，给出排查思路（包括如何打印调试），最后给出修复后的完整代码。请用简体中文回答。",
  },
  {
    id: "optimize",
    label: "代码优化",
    description: "给出命名、结构和性能方面的改进建议",
    placeholder: "粘贴想要优化的代码片段…",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：代码优化。请对用户提供的代码从命名、结构、可读性、性能四个方面给出改进建议，逐条说明每个问题存在的原因以及具体改法，最后给出优化后的完整代码示例。请用简体中文回答。",
  },
  {
    id: "practice",
    label: "出练习题",
    description: "根据知识点生成由易到难的练习题",
    placeholder: "描述你想练习的知识点，例如：\n\n我想练习 JavaScript 的数组 map 和 filter",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：出练习题。请根据用户描述的知识点生成 3 道由易到难的练习题，并标注难度：入门 / 进阶 / 挑战。每题包含两部分：题目描述、思路提示。全部题目写完后，用一条分隔线（---）分隔，给出参考解答。最后鼓励学生先自己动手、再对照答案。请用简体中文回答。",
  },
];

export const MODE_LABEL: Record<ModeId, string> = {
  explain: "逐行讲解",
  debug: "找 Bug",
  optimize: "代码优化",
  practice: "出练习题",
};

export function systemPromptFor(mode: ModeId): string {
  return MODES.find((item) => item.id === mode)?.systemPrompt ?? "";
}

/**
 * 「薄弱点分析」专用提示词：基于历史对话个性化分析学生的知识缺陷
 */
export const WEAKNESS_ANALYSIS_PROMPT = `你是「AI 代码学习助手」，面向编程零基础的大学生。现在请根据学生提供的历史对话记录，做一次「薄弱点分析」：
1. 用一两句话肯定学生已掌握的内容（可引用历史对话中的具体表现）；
2. 列出 2-4 个薄弱环节，每个环节包含三部分：问题是什么（一句话）、为什么会出现（结合历史对话中的具体例子说清楚）、改进建议（一条，最好给出示例代码或明确练习方法）；
3. 最后用一两句话给出「下一步练习方向」。
要求：用简体中文回答；全文 400-500 字；不要客套铺垫，不要空洞的鼓励；用标题和列表组织，条理清晰、信息密集。`;
