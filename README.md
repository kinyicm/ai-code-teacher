# AI 代码学习助手（AI Code Teacher）

面向**编程零基础学生**的 AI 代码老师。粘贴代码或报错，AI 用通俗中文和生活类比，帮你逐行讲解、找 Bug、优化代码、出练习题；还能自动解析 Java 报错、查离线错误手册、记录学习历史，并支持自带模型 API。

本作品为「第九届传智杯全国大学生数智创新与 AI 应用大赛 — AI 创新应用挑战赛（Vibe Coding）」C 组参赛作品，采用 Vibe Coding 方式（AI 辅助编程 + 人工意图引导）开发。

## 功能特性

**四种辅导模式，一键切换：**

- **逐行讲解**：拆解每一句代码的含义，用生活比喻解释
- **找 Bug**：定位错误，说明原因，给出修复代码
- **代码优化**：指出可改进之处，给出更规范的写法
- **出练习题**：根据当前水平生成由易到难的练习题

**其他特性：**

- 基于 Monaco Editor 的代码编辑器（语法高亮、行号、自动缩进）
- 支持 Java / Python / JavaScript / C / C++，粘贴代码后**自动识别语言**
- **Java 报错堆栈智能解析**：识别异常类型、错误消息、出错行号，并用通俗中文解释
- **离线错误手册**：内置常见错误知识库，无网络也能查阅
- **对话历史面板**：自动保存到本地，可回看、可继续
- **自定义模型/API**：可切换任意 OpenAI 兼容接口（baseUrl / 模型名 / Key），默认使用智谱
- AI 流式输出，回答实时呈现；接口限流时自动重试

## 技术栈

- **框架**：Next.js 16（App Router）+ React 19 + TypeScript
- **样式**：Tailwind CSS 4
- **代码编辑器**：Monaco Editor（@monaco-editor/react）
- **Markdown**：react-markdown + remark-gfm + rehype-highlight
- **AI 模型**：智谱 GLM-4.7-Flash（服务端代理，SSE 流式）
- **AI 编程工具**：Trae（Vibe Coding 过程）

## 快速开始（10 分钟复现指南）

### 1. 环境要求

- **Node.js 20.9 或更高**（推荐 20 LTS / 22 LTS），npm 10+
- 一个 AI 模型 API Key（默认用智谱：在 [智谱开放平台](https://bigmodel.cn/) 注册后于控制台创建，新用户有免费额度）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 API Key（二选一）

**方式一：环境变量（推荐）**

把模板复制为 `.env.local` 并填入 Key：

```bash
# Windows PowerShell
Copy-Item .env.example .env.local
```

然后在 `.env.local` 中填写：

```
ZHIPU_API_KEY=你的智谱API Key
```

**方式二：网页内直接填写**

启动后点击页面右上角「模型设置」，粘贴你的 API Key（保存在本地浏览器，不会上传），无需创建 `.env.local`。

> 注意：`.env.local` 已在 `.gitignore` 中，不会被提交到仓库，Key 不会泄露。

### 4. 启动开发服务器

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000) 即可使用。

### 5. 构建生产版本（可选）

```bash
npm run build
npm start
```

## 使用说明

1. 顶部选择辅导模式（逐行讲解 / 找 Bug / 代码优化 / 出练习题）
2. 在左侧选择编程语言（也可直接粘贴代码，会自动识别），粘贴代码或报错
3. 点击「发送」（或按 Ctrl / ⌘ + Enter）
4. 在右侧查看 AI 流式回答；遇到 Java 报错可一键查看通俗解析
5. 左侧「历史」可回看历次对话，「错误手册」可离线查阅常见问题

## 项目结构

```
src/
├── app/
│   ├── page.tsx                  # 主页面（编辑器 / 对话 / 各功能集成）
│   ├── layout.tsx                # 根布局
│   ├── globals.css               # 全局样式
│   ├── favicon.ico
│   └── api/chat/route.ts         # 模型代理（SSE 流式 + 限流重试 + 自定义模型）
├── components/
│   ├── CodeEditor.tsx            # Monaco 代码编辑器
│   ├── MarkdownMessage.tsx       # Markdown 渲染（代码高亮）
│   ├── ErrorHandbook.tsx         # 离线错误手册
│   ├── HistoryPanel.tsx          # 对话历史面板
│   └── ModelSettings.tsx         # 模型 / API 设置弹窗
└── lib/
    ├── modes.ts                  # 四种辅导模式与系统 Prompt
    ├── errorParser.ts            # Java 报错堆栈智能解析
    ├── errorKnowledge.ts         # 离线错误知识库
    ├── languageDetect.ts         # 编程语言自动检测
    └── modelConfig.ts            # 模型配置（localStorage 读写）
```

## 常见问题

- **启动后点发送提示「未配置 API Key」**：按上文第 3 步配置 Key（环境变量或网页设置二选一）。
- **`npm install` 很慢**：可临时切换淘宝镜像 `npm config set registry https://registry.npmmirror.com`。
- **端口 3000 被占用**：运行 `npm run dev -- -p 3001` 换端口。
- 对话历史、模型配置都只保存在你本地浏览器（localStorage），清空浏览器数据会一并删除。

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可。

Copyright © 2026 kinyicm

允许学习、使用与修改，转载或使用请保留原作者署名。
