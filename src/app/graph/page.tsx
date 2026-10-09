export default function GraphPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">理论概念知识图谱</h1>
        <p className="mt-1 text-sm text-stone-600">
          输入一个概念（如「剩余价值」「异化」），AI 将梳理相关文献与关联概念，生成可视化网络。
        </p>
      </div>

      <div className="flex gap-2">
        <input
          placeholder="输入概念，例如：剩余价值"
          className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-red-800"
          disabled
        />
        <button
          disabled
          className="rounded-xl bg-stone-300 px-5 py-2.5 text-sm font-medium text-stone-600"
        >
          生成图谱
        </button>
      </div>

      <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white text-stone-400">
        <p className="text-sm">图谱画布（AntV G6）</p>
        <p className="text-xs">第 3 周实现：概念抽取 → G6 力导向布局 → 节点关联原文跳转</p>
      </div>
    </div>
  );
}
