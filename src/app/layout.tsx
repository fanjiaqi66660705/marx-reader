import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "研读 · AI 马克思主义经典文献平台",
  description: "基于 RAG 的经典著作对话助手与理论概念知识图谱",
};

const navItems = [
  { href: "/", label: "首页" },
  { href: "/chat", label: "AI 对话" },
  { href: "/graph", label: "知识图谱" },
  { href: "/library", label: "文献库" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-red-800 text-sm text-stone-50">
                研
              </span>
              <span>研读 · 马研文献平台</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {navItems.slice(1).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-3 py-1.5 text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-500">
          AI 马克思主义经典文献研读平台 · 引用务必溯源，研读回归原文
        </footer>
      </body>
    </html>
  );
}
