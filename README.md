# AI 代码学习助手（AI Code Teacher）

面向**编程零基础学生**的 AI 代码老师。粘贴代码或报错，AI 用通俗中文和生活类比，帮你逐行讲解、找 Bug、优化代码、出练习题。

本作品为「第九届传智杯全国大学生数智创新与 AI 应用大赛 — AI 创新应用挑战赛（Vibe Coding）」C 组参赛作品，采用 Vibe Coding 方式（AI 辅助编程 + 人工意图引导）开发。

## 功能特性

四种辅导模式，一键切换：

- **逐行讲解**：拆解每一句代码的含义，用生活比喻解释
- **找 Bug**：定位错误，说明原因，给出修复代码
- **代码优化**：指出可改进之处，给出更规范的写法
- **出练习题**：根据当前水平生成由易到难的练习题

其他特性：

- 基于 Monaco Editor 的代码编辑器（语法高亮、行号、自动缩进）
- 支持 Java / Python / JavaScript / C / C++
- AI 流式输出，回答实时呈现
- 对话历史自动保存到本地（localStorage）
- 接口限流时自动重试

## 技术栈

- **框架**：Next.js（App Router）+ React + TypeScript
- **样式**：Tailwind CSS
- **代码编辑器**：Monaco Editor（@monaco-editor/react）
- **AI 模型**：智谱 GLM-4.7-Flash（通过服务端 API 调用）
- **AI 编程工具**：Trae（Vibe Coding 过程）

## 快速开始（10 分钟复现指南）

### 1. 环境要求

- Node.js 18.18 及以上版本（推荐 20 LTS）
- 一个智谱 AI 的 API Key（在 [智谱开放平台](https://bigmodel.cn/) 注册后，于控制台获取）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 API Key

在项目根目录创建 `.env.local` 文件，写入你的 Key：

```
ZHIPU_API_KEY=你的智谱API Key
```

> 注意：`.env.local` 已在 `.gitignore` 中，不会被提交。

### 4. 启动开发服务器

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)，即可使用。

### 5. 构建生产版本（可选）

```bash
npm run build
npm start
```

## 使用说明

1. 选择上方的辅导模式（如"逐行讲解"）
2. 在左侧选择编程语言，粘贴代码
3. 点击"发送"（或按 Ctrl / ⌘ + Enter）
4. 在右侧查看 AI 回答

## 项目结构

```
src/
├── app/
│   ├── page.tsx                 # 主页面
│   ├── layout.tsx               # 根布局
│   ├── globals.css              # 全局样式
│   └── api/chat/route.ts        # 智谱 AI 接口（流式 + 重试）
├── components/
│   ├── CodeEditor.tsx           # Monaco 代码编辑器
│   └── MarkdownMessage.tsx      # Markdown 渲染
└── lib/
    └── modes.ts                 # 四种模式与系统 Prompt
```

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可。

Copyright © 2026 kinyicm

允许学习、使用与修改，转载或使用请保留原作者署名。
