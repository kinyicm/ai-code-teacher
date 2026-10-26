import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 代码学习助手",
  description:
    "面向编程零基础学生的 AI 代码学习助手：逐行讲解、找 Bug、代码优化、出练习题。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        {/* 编辑器从镜像 CDN 加载（约 3.6 MB），提前建连可省掉首次请求的 DNS + TLS 往返。
            React 19 会把这两个 link 提升到 head。 */}
        <link rel="preconnect" href="https://registry.npmmirror.com" />
        <link rel="dns-prefetch" href="https://registry.npmmirror.com" />
        {children}
      </body>
    </html>
  );
}
