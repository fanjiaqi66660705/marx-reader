import { ingestFile } from "../src/lib/ingest";

/**
 * 文献入库 CLI
 * 用法：npm run ingest -- corpus/manifest.txt --title 《共产党宣言》
 */

function parseArgs(argv: string[]): { file: string; title?: string } {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  let title: string | undefined;
  const titleIdx = args.indexOf("--title");
  if (titleIdx !== -1 && args[titleIdx + 1]) title = args[titleIdx + 1];
  if (!file) {
    console.error("用法: npm run ingest -- <文件路径> [--title 《书名》]");
    process.exit(1);
  }
  return { file, title };
}

async function main() {
  const { file, title } = parseArgs(process.argv);
  console.log(`[ingest] 开始入库: ${file}`);
  const result = await ingestFile(file, { title });
  console.log(
    `[ingest] 完成「${result.title}」 document_id=${result.documentId} ` +
      `父块 ${result.parentCount} 个 / 子块 ${result.childCount} 个`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[ingest] 失败:", err);
  process.exit(1);
});
