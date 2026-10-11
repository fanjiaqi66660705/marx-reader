import documents from "@/data-static/documents.json";

interface Doc {
  id: number;
  title: string;
  file_name: string;
  format: string;
  created_at: string;
  child_count: number;
}

export default function LibraryPage() {
  const docs = documents as Doc[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">文献库</h1>
        <p className="mt-1 text-sm text-stone-600">
          已入库的经典文献。所有 AI 回答均限定在此范围内的原文。
        </p>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
          文献库还是空的。
        </div>
      ) : (
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
      )}
    </div>
  );
}
