import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "书页 · 在线出版工作台",
  description: "云端图书排版、结构化编辑与 MCP 自动化。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="shuye-desktop">
      <head>
        <meta name="color-scheme" content="dark" />
        <style media="screen">{'html.shuye-desktop{color-scheme:dark;background:#232323}'}</style>
        <link rel="stylesheet" href="/brand/brand-colors.css" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
