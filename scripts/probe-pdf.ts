import { PDFParse } from "pdf-parse";
import fs from "node:fs";

/**
 * PDF 文本层探针：抽取指定页范围，统计中文字符密度，判断是数字版还是扫描版
 * 用法：npx tsx scripts/probe-pdf.ts <pdf路径> [起始页] [结束页]
 */

const file = process.argv[2];
const first = Number(process.argv[3] ?? 12);
const last = Number(process.argv[4] ?? 22);

const CJK_RE = /[一-鿿]/g;

async function main() {
  const buf = new Uint8Array(fs.readFileSync(file));
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText({ first, last } as Parameters<typeof parser.getText>[0]);
    const perPage = result.pages.map((p) => {
      const cjk = (p.text.match(CJK_RE) ?? []).length;
      return { page: (p as { pageNumber?: number }).pageNumber ?? 0, chars: p.text.length, cjk };
    });
    const totalChars = perPage.reduce((s, p) => s + p.chars, 0);
    const totalCjk = perPage.reduce((s, p) => s + p.cjk, 0);
    console.log(`文件: ${file}`);
    console.log(`页 ${first}-${last}: 总字符=${totalChars} 中文字符=${totalCjk} 平均中文字符/页=${(totalCjk / perPage.length).toFixed(0)}`);
    console.log("前3页明细:", JSON.stringify(perPage.slice(0, 3)));
    const verdict = totalCjk / perPage.length < 30 ? "扫描版（几乎无文本层，需 OCR）" : "数字版（可直接抽文本）";
    console.log(`判定: ${verdict}`);
    const sample = result.text.replace(/\s+/g, " ").slice(0, 150);
    console.log(`样例: ${sample}`);
  } finally {
    await parser.destroy();
  }
}

main().catch((e) => {
  console.error("探针失败:", e);
  process.exit(1);
});
