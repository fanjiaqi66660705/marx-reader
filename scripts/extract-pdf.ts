import { PDFParse } from "pdf-parse";
import fs from "node:fs";
import path from "node:path";

/**
 * 数字版 PDF 全文抽取为 txt（供 ingest 使用）
 * 用法：npx tsx scripts/extract-pdf.ts <pdf路径> <输出txt路径>
 */

const input = process.argv[2];
const output = process.argv[3];

if (!input || !output) {
  console.error("用法: npx tsx scripts/extract-pdf.ts <pdf路径> <输出txt路径>");
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(input)) });
  try {
    const result = await parser.getText();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, result.text, "utf-8");
    const cjk = (result.text.match(/[一-鿿]/g) ?? []).length;
    console.log(
      `[extract] ${path.basename(input)} → ${output} | ${result.total} 页, ${(result.text.length / 10000).toFixed(1)} 万字, 中文 ${(cjk / 10000).toFixed(1)} 万字, ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
  } finally {
    await parser.destroy();
  }
}

main().catch((e) => {
  console.error("[extract] 失败:", e);
  process.exit(1);
});
