/**
 * Java 异常堆栈智能解析器
 * 识别常见的 Java 报错格式，提取异常类型、错误消息、出错文件和行号，
 * 生成面向零基础学生的结构化摘要，辅助 AI 更精准地讲解。
 */

export interface ParsedError {
  isJavaStack: boolean;
  exceptionType?: string;
  exceptionSimple?: string; // 简短类名，如 ArrayIndexOutOfBoundsException
  message?: string;
  thread?: string;
  locations: { file: string; line?: number; method?: string }[];
  summary: string; // 面向学生的中文摘要
}

/**
 * 常见 Java 异常的通俗解释（面向零基础）
 */
const EXCEPTION_GLOSSARY: Record<string, string> = {
  ArrayIndexOutOfBoundsException:
    "数组下标越界：访问了数组不存在的位置（比如数组只有5个元素，却访问第6个）",
  NullPointerException:
    "空指针异常：调用了一个值为 null（空）的对象的方法或属性，相当于对一个不存在的东西发指令",
  NumberFormatException:
    "数字格式错误：把一个不是数字的字符串（如\"abc\"）强行转成数字",
  ArithmeticException: "算术异常：最常见的是除以 0",
  ClassCastException: "类型转换错误：把一个对象强行转成了它不是的类型",
  IllegalArgumentException: "参数不合法：传给方法的参数不符合要求",
  IllegalStateException: "状态不合法：在错误的时机调用了方法",
  IndexOutOfBoundsException: "索引越界：访问了集合/字符串不存在的位置",
  StringIndexOutOfBoundsException: "字符串索引越界：访问了字符串不存在的字符位置",
  OutOfMemoryError: "内存不足：程序占用的内存超过了 JVM 分配的上限",
  StackOverflowError: "栈溢出：通常是递归调用没有终止条件，无限循环调用自己",
  FileNotFoundException: "文件不存在：指定路径的文件找不到",
  IOException: "输入输出异常：读写文件或网络时出错",
  SQLException: "数据库异常：执行 SQL 或连接数据库时出错",
  ClassNotFoundException: "类找不到：运行时缺少需要的类（通常是 jar 包没导入）",
  NoSuchMethodError: "方法找不到：调用了一个不存在的方法（版本不匹配）",
  ConcurrentModificationException:
    "并发修改异常：在遍历集合（如 for-each）的同时修改了集合内容",
  UnsupportedOperationException:
    "不支持的操作：调用了当前对象不支持的方法（如不可变集合的 add）",
  InputMismatchException: "输入类型不匹配：Scanner 读取的内容类型不对",
  NoSuchElementException: "没有更多元素：Scanner 或 Iterator 已经读完还继续取",
};

function simpleName(full: string): string {
  const dot = full.lastIndexOf(".");
  return dot >= 0 ? full.slice(dot + 1) : full;
}

/** 判断方法所属的类是否属于 JDK 或常见库内部（这些帧一般不展示给学生作为出错点） */
function isInternalMethod(method: string): boolean {
  return /^(java\.|javax\.|jdk\.|sun\.|com\.sun\.|org\.gradle|kotlin\.|scala\.)/.test(
    method,
  );
}

export function parseJavaError(input: string): ParsedError {
  const text = input.trim();
  const result: ParsedError = {
    isJavaStack: false,
    locations: [],
    summary: "",
  };

  // 识别 Java 异常堆栈：
  // - 堆栈行（"at 包.类.方法(...)"）或 "Exception in thread" 行，必然是真堆栈
  // - 异常类型出现在行首（如 "java.lang.NullPointerException: xxx"），可视为异常输出
  const hasAtLine = /^\s*at\s+/m.test(text);
  const hasThreadLine = /Exception in thread/.test(text);
  const exceptionAtLineStart =
    /^\s*(?:[\w$]+\.)*[\w$]+(?:Exception|Error)\s*(?::|$)/m.test(text);

  if (!hasAtLine && !hasThreadLine && !exceptionAtLineStart) {
    return result;
  }

  result.isJavaStack = true;

  // 提取线程名：Exception in thread "xxx"
  const threadMatch = text.match(/Exception in thread\s+"([^"]+)"/);
  if (threadMatch) result.thread = threadMatch[1];

  // 提取异常类型和消息：第一行的 xxxException: message
  const firstLine = text.split("\n")[0] ?? "";
  const excMatch = firstLine.match(
    /((?:[\w$]+\.)*([\w$]+(?:Exception|Error)))(?::\s*(.+))?$/,
  );
  if (excMatch) {
    result.exceptionType = excMatch[1];
    result.exceptionSimple = excMatch[2];
    if (excMatch[3]) result.message = excMatch[3].trim();
  } else {
    // 异常可能不在第一行，全局搜索
    const globalExc = text.match(
      /((?:[\w$]+\.)*([\w$]+(?:Exception|Error)))(?::\s*([^\n]+))?/,
    );
    if (globalExc) {
      result.exceptionType = globalExc[1];
      result.exceptionSimple = globalExc[2];
      if (globalExc[3]) result.message = globalExc[3].trim();
    }
  }

  // 提取堆栈位置：at 包.类.方法(文件:行号)，类前缀兼容 Java 9+ 模块写法（如 java.base/java.lang.Integer）
  const atRegex =
    /^\s*at\s+([\w$./]+)\.([\w$<>]+)\(([^:)]+)(?::(\d+))?\)/gm;
  let m: RegExpExecArray | null;
  while ((m = atRegex.exec(text)) !== null) {
    result.locations.push({
      file: m[3],
      line: m[4] ? parseInt(m[4], 10) : undefined,
      method: `${m[1]}.${m[2]}`,
    });
  }

  // 生成面向学生的中文摘要
  const parts: string[] = [];
  if (result.exceptionSimple) {
    const gloss = EXCEPTION_GLOSSARY[result.exceptionSimple];
    parts.push(
      `异常类型：${result.exceptionSimple}${gloss ? `（${gloss}）` : ""}`,
    );
  }
  if (result.message) {
    parts.push(`错误信息：${result.message}`);
  }
  if (result.locations.length > 0) {
    // 优先展示用户自己代码中的出错帧，跳过 JDK/库内部帧，
    // 避免把 "java.lang.NumberFormatException.forInputString" 这类内部方法当作出错点
    const userFrame =
      result.locations.find((l) => !isInternalMethod(l.method ?? "")) ??
      result.locations[0];
    const loc = userFrame.line
      ? `${userFrame.file} 第 ${userFrame.line} 行`
      : userFrame.file;
    parts.push(`出错位置：${loc}（方法 ${userFrame.method ?? "未知"}）`);
  }
  if (/^\s*Caused by:/m.test(text)) {
    parts.push("提示：该异常由更深层的原因引发（Caused by），根因在下面的异常链里");
  }
  if (result.thread) {
    parts.push(`发生线程：${result.thread}`);
  }

  result.summary = parts.join("\n");
  return result;
}

/**
 * 判断输入是否像报错堆栈（用于自动触发解析）
 */
export function looksLikeErrorStack(input: string): boolean {
  const text = input.trim();
  return (
    /\b\w+Exception\b/.test(text) ||
    /\b\w+Error\b/.test(text) ||
    /^\s*at\s+/m.test(text) ||
    /Exception in thread/.test(text)
  );
}
