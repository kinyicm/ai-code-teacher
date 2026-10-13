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
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：逐行讲解。请把用户提供的代码逐行讲解，说明每个变量、语句、控制流的作用，并用通俗的比喻帮助理解；最后总结这段代码涉及的关键知识点。请用简体中文回答，结构清晰、循序渐进。",
  },
  {
    id: "debug",
    label: "找 Bug",
    description: "根据报错信息或可疑代码，定位错误原因",
    placeholder:
      "粘贴报错信息或可疑代码，例如：\n\nTypeError: Cannot read properties of undefined (reading 'map')",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：找 Bug。用户可能粘贴报错信息或可疑代码。请定位错误发生的根本原因，用通俗语言解释为什么会报错，给出排查思路（包括如何打印调试），并给出修复后的代码。请用简体中文回答，面向零基础读者。",
  },
  {
    id: "optimize",
    label: "代码优化",
    description: "给出命名、结构和性能方面的改进建议",
    placeholder: "粘贴想要优化的代码片段…",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：代码优化。请对用户提供的代码给出命名、结构、可读性和性能方面的改进建议，解释每一条建议的原因，并给出优化后的完整代码示例。请用简体中文回答。",
  },
  {
    id: "practice",
    label: "出练习题",
    description: "根据知识点生成由易到难的练习题",
    placeholder: "描述你想练习的知识点，例如：\n\n我想练习 JavaScript 的数组 map 和 filter",
    systemPrompt:
      "你是「AI 代码学习助手」，面向编程零基础的大学生。当前模式：出练习题。请根据用户描述的知识点生成 3 道由易到难的练习题（入门 / 进阶 / 挑战），每题给出题目、思路提示，最后用分隔线分隔并给出参考解答。请用简体中文回答，鼓励学生先自己动手再对照答案。",
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
