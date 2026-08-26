import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小词格 · AI 歌词生成器",
  description: "纯大模型驱动、多轮自我迭代与对抗评审的全自动歌词生成器",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
