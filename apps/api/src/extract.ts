import type { Evidence, ExtractedItem, Note, SourcedNumber, SourcedText } from "@insta-quote/shared";
import { extractPdfPages, groupIntoRows, type PdfRow, type PdfTextItem } from "./pdf";

type Column = "item" | "description" | "quantity" | "unit" | "unitPrice" | "lineTotal" | "weight";
type Header = { y: number; starts: Partial<Record<Column, number>>; hasLineTotal: boolean };
type Details = { details: Record<string, SourcedText[]>; notes: Note[] };
type Classification = { items: ExtractedItem[]; tableLines: Set<number> };

const labels: Array<[Column, RegExp]> = [
  ["item", /^item(?:\s|$)/i], ["description", /^(?:description|product|details)$/i],
  ["quantity", /^(?:qty|quantity)$/i], ["unit", /^unit$/i], ["unitPrice", /^(?:unit\s*price|price)$/i],
  ["lineTotal", /^(?:line\s*total|amount)$/i], ["weight", /^weight$/i],
];

function clean(token: PdfTextItem): string { return token.text.trim(); }
function context(row: PdfRow): string { return row.tokens.map(clean).filter(Boolean).join(" "); }
function contentRows(rows: PdfRow[]): PdfRow[] {
  return rows.map((row) => ({ ...row, tokens: row.tokens.filter((token) => !clean(token).startsWith("-----------")) })).filter((row) => row.tokens.length > 0);
}
function rowEvidence(row: PdfRow, sourceText = context(row)): Evidence { return { page: row.pageNumber, line: row.lineNumber, sourceText }; }
function sourcedRow(row: PdfRow, value: string): SourcedText { return { value, evidence: rowEvidence(row) }; }

export function extractDetails(pages: Array<{ pageNumber: number; rows: PdfRow[]; tableLines?: Set<number> }>): Details {
  const details: Record<string, SourcedText[]> = Object.create(null);
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const page of pages) for (const row of contentRows(page.rows)) {
    if (page.tableLines?.has(row.lineNumber)) continue;
    const text = context(row);
    const match = text.match(/^([^:]+?)\s*:\s*(.+)$/);
    const label = match ? match[1]!.trim() : "Text";
    const value = match ? match[2]!.trim() : text;
    const key = JSON.stringify([row.pageNumber, label, value]);
    if (seen.has(key)) continue;
    (details[label] ??= []).push(sourcedRow(row, value));
    seen.add(key);
  }
  return { details, notes };
}

function findHeader(rows: PdfRow[]): Header | undefined {
  for (const row of rows) {
    const starts: Partial<Record<Column, number>> = {};
    for (const token of row.tokens) {
      const text = clean(token);
      for (const [column, pattern] of labels) if (pattern.test(text)) starts[column] ??= token.x;
    }
    if (starts.item !== undefined && starts.description !== undefined && starts.quantity !== undefined && starts.unitPrice !== undefined) {
      return { y: row.y, starts, hasLineTotal: starts.lineTotal !== undefined };
    }
  }
}

function cellTokens(row: PdfRow, header: Header, column: Column): PdfTextItem[] {
  const start = header.starts[column];
  if (start === undefined) return [];
  const next = Object.values(header.starts).filter((x): x is number => x > start).sort((a, b) => a - b)[0] ?? Infinity;
  return row.tokens.filter((token) => token.x >= start - 1 && token.x < next - 1 && clean(token) !== "");
}

function parseNumber(token: PdfTextItem | undefined, kind: "quantity" | "money", page: number, row: PdfRow): SourcedNumber | undefined {
  if (!token) return;
  const sourceText = token.text.trim();
  const syntax = kind === "quantity"
    ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
    : /^(?:NZ\s*)?\$?\s*((?:\d+|\d{1,3}(?:,\d{3})+))(?:\.(\d{2}))?(?:\s*\/\s*[a-z]+)?$/i;
  const match = sourceText.match(syntax);
  if (!match) return;
  const numericText = kind === "quantity" ? sourceText : sourceText.replace(/^(?:NZ\s*)?\$?\s*/i, "").replace(/\s*\/\s*[a-z]+$/i, "");
  const value = Number(numericText.replaceAll(",", ""));
  if (!Number.isFinite(value) || value < 0) return;
  return { value, evidence: { ...rowEvidence(row, token.text), contextText: context(row) } };
}

export function classifyRows(rows: PdfRow[]): Classification {
  const header = findHeader(rows);
  if (!header) {
    const items: ExtractedItem[] = [];
    for (const row of rows) {
      const first = row.tokens.find((token) => clean(token) !== "");
      const rest = row.tokens.filter((token) => token !== first);
      const hasNumericCell = rest.some((token) => /^(?:(?:NZ|US|AU)\s*)?\$?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:NZD|USD|AUD))?$/i.test(clean(token)));
      if (first && /^\d{1,3}[.)]?$/.test(clean(first)) && rest.length >= 2 && hasNumericCell) {
        items.push({ description: rest.map(clean).join(" "), evidence: rowEvidence(row), error: { code: "COLUMN_AMBIGUITY", message: "This line appears to be an item, but its table columns could not be identified safely." } });
      }
    }
    return { items, tableLines: new Set(items.map((item) => item.evidence.line!)) };
  }
  const items: ExtractedItem[] = [];
  const tableLines = new Set<number>();
  const errorItem = (row: PdfRow, code: string, message: string, description?: string): ExtractedItem => {
    const quantityTokens = cellTokens(row, header, "quantity");
    const priceTokens = cellTokens(row, header, "unitPrice");
    const totalTokens = cellTokens(row, header, "lineTotal");
    const quantity = quantityTokens.length === 1 ? parseNumber(quantityTokens[0], "quantity", row.pageNumber, row) : undefined;
    const unitPrice = priceTokens.length === 1 ? parseNumber(priceTokens[0], "money", row.pageNumber, row) : undefined;
    const lineTotal = totalTokens.length === 1 ? parseNumber(totalTokens[0], "money", row.pageNumber, row) : undefined;
    return { ...(description ? { description } : {}), evidence: rowEvidence(row), ...(quantity ? { quantity } : {}), ...(unitPrice ? { unitPrice } : {}), ...(lineTotal ? { lineTotal } : {}), error: { code, message } };
  };

  for (const row of rows) {
    if (row.y > header.y) continue;
    if (row.y === header.y) { tableLines.add(row.lineNumber); continue; }
    const allText = context(row);
    if (/^Total\s*:?\s*.+$/i.test(allText)) {
      continue;
    }
    const itemCell = cellTokens(row, header, "item");
    const description = cellTokens(row, header, "description").map(clean).filter(Boolean).join(" ");
    const candidateItem = itemCell.length > 0 && /^\d+[.)]?$/.test(clean(itemCell[0]!));
    if (!candidateItem) {
      const valueCellCount = (["quantity", "unitPrice", "lineTotal"] as Column[]).filter((column) => cellTokens(row, header, column).length > 0).length;
      if (description && valueCellCount > 0) {
        tableLines.add(row.lineNumber);
        items.push(errorItem(row, "INVALID_ITEM_NUMBER", "This line has item details, but its item number is missing or unclear.", description));
        continue;
      }
      if (!description && valueCellCount >= 2) {
        tableLines.add(row.lineNumber);
        items.push(errorItem(row, "UNVERIFIABLE_VALUE", "This line contains several numeric values but has no clear item number or description."));
        continue;
      }
      continue;
    }
    tableLines.add(row.lineNumber);
    const fail = (code: string, message: string) => items.push(errorItem(row, code, message, description || undefined));
    if (!description) { fail("UNVERIFIABLE_VALUE", "This line appears to be an item, but its description is missing."); continue; }
    if (!header.hasLineTotal) { fail("MISSING_LINE_TOTAL", "This table does not provide a line total for this item, so none was calculated."); continue; }
    const quantityCell = cellTokens(row, header, "quantity");
    const priceCell = cellTokens(row, header, "unitPrice");
    const totalCell = cellTokens(row, header, "lineTotal");
    if (!quantityCell.length) { fail("MISSING_QUANTITY", "The quantity for this item is missing, so it could not be verified."); continue; }
    if (quantityCell.length > 1) { fail("COLUMN_AMBIGUITY", "More than one value appears in the quantity column, so the quantity could not be identified safely."); continue; }
    if (!parseNumber(quantityCell[0], "quantity", row.pageNumber, row)) { fail("INVALID_QUANTITY", "The quantity for this item is unclear or not a valid number."); continue; }
    if (!priceCell.length) { fail("MISSING_UNIT_PRICE", "The unit price for this item is missing, so it could not be verified."); continue; }
    if (priceCell.length > 1) { fail("COLUMN_AMBIGUITY", "More than one value appears in the unit price column, so the price could not be identified safely."); continue; }
    if (!parseNumber(priceCell[0], "money", row.pageNumber, row)) { fail("INVALID_UNIT_PRICE", "The unit price for this item is unclear or not a valid amount."); continue; }
    if (!header.hasLineTotal || !totalCell.length) { fail("MISSING_LINE_TOTAL", "This table does not provide a line total for this item, so none was calculated."); continue; }
    if (totalCell.length > 1) { fail("COLUMN_AMBIGUITY", "More than one value appears in the line total column, so the total could not be identified safely."); continue; }
    if (!parseNumber(totalCell[0], "money", row.pageNumber, row)) { fail("INVALID_LINE_TOTAL", "The line total for this item is unclear or not a valid amount."); continue; }

    const quantity = parseNumber(quantityCell[0], "quantity", row.pageNumber, row)!;
    const unitPrice = parseNumber(priceCell[0], "money", row.pageNumber, row)!;
    const lineTotal = parseNumber(totalCell[0], "money", row.pageNumber, row)!;
    if (Math.abs(quantity.value * unitPrice.value - lineTotal.value) > 0.010001) {
      fail("ARITHMETIC_CONTRADICTION", "The quantity and unit price do not match the line total shown in the document.");
      continue;
    }
    items.push({ description, evidence: { ...rowEvidence(row, description), contextText: context(row) }, quantity, unitPrice, lineTotal });
  }
  return { items, tableLines };
}

function classifyOcrRows(rows: PdfRow[]): Classification {
  const header = rows.find((row) => row.tokens.some((token) => /^item$/i.test(clean(token))) && row.tokens.some((token) => /^description$/i.test(clean(token))));
  if (!header) return { items: [], tableLines: new Set() };
  const itemStart = header.tokens.find((token) => /^item$/i.test(clean(token)))!.x;
  const quantityStart = header.tokens.find((token) => /^qty$/i.test(clean(token)))?.x ?? Infinity;
  const items = rows.flatMap((row) => {
    if (row.y >= header.y) return [];
    const itemNumber = row.tokens[0];
    if (!itemNumber || itemNumber.x > itemStart + 20 || !/^\d+[.)]?$/.test(clean(itemNumber))) return [];
    const description = row.tokens.filter((token) => token.x > itemNumber.x && token.x < quantityStart).map(clean).join(" ");
    if (!description) return [];
    const message = "OCR found this item row, but its quantities and prices could not be verified from selectable PDF text.";
    return [{
      description,
      evidence: rowEvidence(row),
      error: { code: "OCR_REQUIRES_VERIFICATION", message },
    }];
  });
  return { items, tableLines: new Set([header.lineNumber, ...items.map((item) => item.evidence.line!)]) };
}

export async function extractDocument(buffer: ArrayBuffer): Promise<{ items: ExtractedItem[] } & Details> {
  const pages = await extractPdfPages(buffer);
  const items: ExtractedItem[] = [];
  const notes: Note[] = [];
  const detailPages: Array<{ pageNumber: number; rows: PdfRow[]; tableLines?: Set<number> }> = [];

  for (const page of pages) {
    const printable = page.items.filter((token) => clean(token) !== "");
    if (page.ocr) {
      const rows = groupIntoRows(page.pageNumber, printable, 1);
      const result = classifyOcrRows(rows);
      detailPages.push({ pageNumber: page.pageNumber, rows, tableLines: result.tableLines });
      if (result.items.length) items.push(...result.items);
      else {
        const message = "This page has no readable item rows, so its contents could not be checked.";
        notes.push({ value: message, page: page.pageNumber, error: { code: "UNREADABLE_CONTENT", message } });
      }
      continue;
    }
    if (page.error || printable.length === 0) {
      const message = "This page has no readable text, so its contents could not be checked.";
      notes.push({ value: message, page: page.pageNumber, error: { code: "UNREADABLE_CONTENT", message } });
      continue;
    }
    const rows = contentRows(groupIntoRows(page.pageNumber, printable));
    if (rows.length === 0) {
      const message = "This page has no readable text, so its contents could not be checked.";
      notes.push({ value: message, page: page.pageNumber, error: { code: "UNREADABLE_CONTENT", message } });
      continue;
    }
    const result = classifyRows(rows);
    detailPages.push({ pageNumber: page.pageNumber, rows, tableLines: result.tableLines });
    items.push(...result.items);
  }

  const extractedDetails = extractDetails(detailPages);
  return { items, ...extractedDetails, notes: [...extractedDetails.notes, ...notes] };
}
