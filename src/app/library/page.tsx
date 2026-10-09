import { Suspense } from "react";
import { connection } from "next/server";
import { listDocuments } from "@/lib/ingest";

async function DocList() {
  await connection(); // 动态读取本地数据库
  const docs = listDocuments() as Array<{
    id: number;
    title: string;
    file_name: string;
    format: string;
    created_at: string;
    child_count: number;
  }>;

  if (docs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
        文献库还是空的。运行 <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">npm run ingest -- 文件路径 --title 《书名》</code> 入库第一批经典文献。
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs text-stone-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">书名</th>
            <th className="px-4 py-2.5 font-medium">文件</th>
            <th className="px-4 py-2.5 font-medium">子块数</th>
            <th className="px-4 py-2.5 font-medium">入库时间</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-t border-stone-100">
              <td className="px-4 py-2.5 font-medium">{d.title}</td>
              <td className="px-4 py-2.5 text-stone-500">
                {d.file_name}（{d.format}）
              </td>
              <td className="px-4 py-2.5">{d.child_count}</td>
              <td className="px-4 py-2.5 text-stone-500">{d.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">文献库</h1>
        <p className="mt-1 text-sm text-stone-600">
          已入库的经典文献。所有 AI 回答均限定在此范围内的原文。
        </p>
      </div>
      <Suspense fallback={<div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500">加载中…</div>}>
        <DocList />
      </Suspense>
    </div>
  );
}
