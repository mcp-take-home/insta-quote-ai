import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
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

export type PdfPage = { pageNumber: number; items: PdfTextItem[]; error?: string };

export async function extractPdfPages(buffer: ArrayBuffer): Promise<PdfPage[]> {
  const pdf = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl }).promise;
  const pages: PdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        items: content.items.filter((item) => "str" in item).map((item) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        })),
      });
    } catch {
      pages.push({ pageNumber, items: [], error: "The page text could not be read." });
    }
  }

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
