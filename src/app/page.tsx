import Link from "next/link";

const features = [
  {
    href: "/chat",
    title: "经典著作 AI 对话助手",
    desc: "上传或选择《资本论》《共产党宣言》等经典文献，AI 基于原文回答理论疑问，每句回答附带原文引用与出处，拒绝凭空发挥。",
    tag: "RAG · 引用溯源",
  },
  {
    href: "/graph",
    title: "理论概念知识图谱",
    desc: "输入「剩余价值」「异化」等概念，AI 自动梳理相关文献与关联概念，生成可视化的概念网络，看清理论脉络。",
    tag: "AntV G6 · 可视化",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm font-medium tracking-widest text-red-800">
          经典研读 · 理论探讨 · 学术交流
        </p>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
          AI 马克思主义经典文献研读平台
        </h1>
        <p className="max-w-2xl text-stone-600">
          让 AI 帮你翻书，而不是替你读书。基于检索增强生成（RAG）的对话助手严格锚定原文，
          配合概念知识图谱，把经典著作的论证链条读透。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="group flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="w-fit rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-800">
              {f.tag}
            </span>
            <h2 className="text-lg font-semibold group-hover:text-red-900">{f.title}</h2>
            <p className="text-sm leading-relaxed text-stone-600">{f.desc}</p>
            <span className="mt-auto text-sm font-medium text-red-800">
              进入 {f.href === "/chat" ? "对话" : "图谱"} →
            </span>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="mb-2 font-semibold">为什么强调「原文引用」？</h2>
        <p className="text-sm leading-relaxed text-stone-600">
          研读经典最忌「我以为马克思说过」。本平台采用父子分块 + 混合检索架构：
          每次回答前先在本地文献库中检索原文片段，回答中逐句标注出处（著作、章节、原文引文），
          引用可点击展开核对全文。AI 只做串联与解释，不做无据发挥。
        </p>
      </section>
    </div>
  );
}
