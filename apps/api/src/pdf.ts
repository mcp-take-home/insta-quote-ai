import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, type Worker } from "tesseract.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const standardFontDataUrl = `${fileURLToPath(new URL("../../standard_fonts/", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")))}/`;

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfRow = {
  pageNumber: number;
  lineNumber: number;
  y: number;
  tokens: PdfTextItem[];
};

export type PdfPage = { pageNumber: number; items: PdfTextItem[]; ocr?: boolean; error?: string };

const languageDataPath = join(dirname(fileURLToPath(import.meta.resolve("@tesseract.js-data/eng"))), "4.0.0");
type PdfJsDocument = Awaited<ReturnType<typeof getDocument>["promise"]>;
type PdfJsPage = Awaited<ReturnType<PdfJsDocument["getPage"]>>;

async function recognizePage(page: PdfJsPage, worker: Worker): Promise<PdfTextItem[]> {
  const scale = 3;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const canvasContext = canvas.getContext("2d");
  await page.render({ canvas, canvasContext, viewport }).promise;
  const { data } = await worker.recognize(canvas.toBuffer("image/png"), {}, { tsv: true });
  const lines = new Map<string, { y: number; items: PdfTextItem[] }>();
  for (const entry of data.tsv?.split(/\r?\n/).slice(1) ?? []) {
    const [level, , block, paragraph, line, , left, top, width, height, , ...text] = entry.split("\t");
    const value = text.join("\t").trim();
    if (level !== "5" || !value) continue;
    const x = Number(left);
    const yTop = Number(top);
    const wordWidth = Number(width);
    const wordHeight = Number(height);
    if (![x, yTop, wordWidth, wordHeight].every(Number.isFinite)) continue;
    const key = `${block}:${paragraph}:${line}`;
    const rowY = (canvas.height - yTop) / scale;
    const row = lines.get(key) ?? { y: rowY, items: [] };
    row.items.push({ text: value, x: x / scale, y: row.y, width: wordWidth / scale, height: wordHeight / scale });
    lines.set(key, row);
  }
  return [...lines.values()].flatMap((line) => line.items);
}

export async function extractPdfPages(buffer: ArrayBuffer): Promise<PdfPage[]> {
  const pdf = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl }).promise;
  const pages: PdfPage[] = [];
  let worker: Worker | undefined;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item) => "str" in item).map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      })).filter((item) => item.text.trim() !== "");
      if (items.length) {
        pages.push({ pageNumber, items });
        continue;
      }
      worker ??= await createWorker("eng", 1, { langPath: languageDataPath, cacheMethod: "none" });
      pages.push({
        pageNumber,
        items: await recognizePage(page, worker),
        ocr: true,
      });
    } catch {
      pages.push({ pageNumber, items: [], error: "The page text could not be read." });
    }
  }

  await worker?.terminate();

  return pages;
}

export function groupIntoRows(pageNumber: number, items: PdfTextItem[], tolerance = 2): PdfRow[] {
  const sorted = items.filter((item) => item.text.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfRow[] = [];
  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) {
      row.tokens.push(item);
      row.tokens.sort((a, b) => a.x - b.x);
    } else rows.push({ pageNumber, lineNumber: 0, y: item.y, tokens: [item] });
  }
  return rows.sort((a, b) => b.y - a.y).map((row, index) => ({ ...row, lineNumber: index + 1 }));
}
