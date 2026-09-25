import type { Evidence, ExtractedItem, Note, SourcedNumber, SourcedText } from "@insta-quote/shared";
import { extractPdfPages, groupIntoRows, type PdfRow, type PdfTextItem } from "./pdf";

type Column = "item" | "description" | "quantity" | "unit" | "unitPrice" | "lineTotal" | "weight";
type Header = { y: number; starts: Partial<Record<Column, number>>; hasLineTotal: boolean };
type Details = { details: Record<string, SourcedText[]>; notes: Note[] };
type Classification = { items: ExtractedItem[]; total?: SourcedNumber; tableLines: Set<number> };
type PageTotal = { value: SourcedNumber; items: ExtractedItem[]; complete: boolean };

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
  for (const page of pages) for (const row of contentRows(page.rows)) {
    if (page.tableLines?.has(row.lineNumber)) continue;
    const text = context(row);
    if (/^(?:document\s+)?total\s*:?\s*(?:(?:(?:NZ|US|AU)\s*\$)|(?:NZD|USD|AUD)\s*|[$€£])?\s*(?:\(-?\d[\d,]*(?:\.\d{1,2})?\)|-?\d[\d,]*(?:\.\d{1,2})?)(?:\s*(?:NZD|USD|AUD))?$/i.test(text)) continue;
    const match = text.match(/^([^:]+?)\s*:\s*(.+)$/);
    if (match) (details[match[1]!.trim()] ??= []).push(sourcedRow(row, match[2]!.trim()));
    else notes.push({ value: text, evidence: rowEvidence(row) });
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

export function documentTotalContradicts(total: SourcedNumber, items: ExtractedItem[], scopeKnown: boolean, complete: boolean): boolean {
  return scopeKnown && complete && items.every((item) => item.lineTotal && !item.error) && Math.abs(items.reduce((sum, item) => sum + item.lineTotal!.value, 0) - total.value) > 0.010001;
}

export function multiPageTotalNote(total: SourcedNumber, pageCount: number): Note | undefined {
  if (pageCount <= 1) return;
  const message = "This stated total cannot be reconciled because the document spans multiple pages and its page scope is unclear.";
  return {
    value: message,
    error: { code: "UNVERIFIABLE_VALUE", message },
    page: total.evidence.page,
    line: total.evidence.line,
    sourceText: total.evidence.sourceText,
    contextText: total.evidence.contextText,
  };
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
  let total: SourcedNumber | undefined;
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
      tableLines.add(row.lineNumber);
      const source = row.tokens.find((token) => /^(?:NZ\s*)?\$?\s*\d/i.test(clean(token)));
      total = parseNumber(source, "money", row.pageNumber, row);
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
  return { items, tableLines, ...(total ? { total } : {}) };
}

const excludedPage = /\b(summary|returns? note|credit adjustment|signed acceptance|acceptance)\b/i;

export async function extractDocument(buffer: ArrayBuffer): Promise<{ items: ExtractedItem[] } & Details> {
  const pages = await extractPdfPages(buffer);
  const items: ExtractedItem[] = [];
  const notes: Note[] = [];
  const totals: PageTotal[] = [];
  const readablePageText: Array<{ pageNumber: number; text: string }> = [];
  const detailPages: Array<{ pageNumber: number; rows: PdfRow[]; tableLines?: Set<number> }> = [];

  for (const page of pages) {
    const printable = page.items.filter((token) => clean(token) !== "");
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
    const text = rows.map(context).join(" ");
    readablePageText.push({ pageNumber: page.pageNumber, text });
    const heading = rows.slice(0, 6).map(context).join(" ");
    if (excludedPage.test(heading)) {
      const result = classifyRows(rows);
      detailPages.push({ pageNumber: page.pageNumber, rows, tableLines: result.tableLines });
      const pageType = /summary/i.test(heading) ? "summary" : "returns, credit, or acceptance";
      const itemMessage = pageType === "summary"
        ? "This item appears on a summary page, so its values were not accepted to avoid counting the same delivery twice."
        : "This item appears on a returns, credit, or acceptance page, so its values were not accepted as new delivery items.";
      items.push(...result.items.map((item) => ({ ...(item.description ? { description: item.description } : {}), evidence: item.evidence, error: { code: "UNVERIFIABLE_VALUE" as const, message: itemMessage } })));
      const message = /summary/i.test(heading)
        ? "This summary page repeats delivery information, so its rows were skipped to avoid counting the same items twice."
        : "This returns, credit, or acceptance page repeats delivery lines in a different context, so its rows were skipped to avoid counting them as new items.";
      const sourceRow = rows.slice(0, 6).find((row) => excludedPage.test(context(row)));
      notes.push({ value: message, page: page.pageNumber, ...(sourceRow ? { line: sourceRow.lineNumber } : {}), sourceText: sourceRow ? context(sourceRow) : heading, error: { code: "UNVERIFIABLE_VALUE", message } });
      continue;
    }
    const result = classifyRows(rows);
    detailPages.push({ pageNumber: page.pageNumber, rows, tableLines: result.tableLines });
    items.push(...result.items);
    if (result.total) totals.push({ value: result.total, items: result.items, complete: result.items.every((item) => !item.error) });
  }

  const palletNotes = readablePageText.flatMap((page) => {
    const depot = page.text.match(/(\d+)\s+pallets?\s+loaded at depot/i);
    const site = page.text.match(/(\d+)\s+pallets?\s+unloaded at site/i);
    if (!depot || !site || depot[1] === site[1]) return [];
    const rows = detailPages.find((entry) => entry.pageNumber === page.pageNumber)?.rows ?? [];
    const depotRow = rows.find((candidate) => context(candidate).includes(depot[0]));
    const siteRow = rows.find((candidate) => context(candidate).includes(site[0]));
    return [{ pageNumber: page.pageNumber, lines: [...new Set([depotRow?.lineNumber, siteRow?.lineNumber].filter((line): line is number => line !== undefined))], depot: depot[0], site: site[0] }];
  });
  for (const note of palletNotes) {
    const message = "The pallet counts in the depot and site notes do not agree; please check the delivery record.";
    notes.push({ value: message, page: note.pageNumber, ...(note.lines.length ? { lines: note.lines } : {}), sourceText: `${note.depot}; ${note.site}`, error: { code: "CONFLICTING_VALUES", message } });
  }

  for (const documentTotal of totals) {
    const multiPageNote = multiPageTotalNote(documentTotal.value, pages.length);
    if (multiPageNote) {
      notes.push(multiPageNote);
      continue;
    }
    if (documentTotalContradicts(documentTotal.value, documentTotal.items, pages.length === 1, documentTotal.complete)) {
      const message = "The stated document total does not match the sum of the verified line totals.";
      notes.push({ value: message, error: { code: "ARITHMETIC_CONTRADICTION", message }, page: documentTotal.value.evidence.page, line: documentTotal.value.evidence.line, sourceText: documentTotal.value.evidence.sourceText, contextText: documentTotal.value.evidence.contextText });
      break;
    }
  }

  const extractedDetails = extractDetails(detailPages);
  return { items, ...extractedDetails, notes: [...extractedDetails.notes, ...notes] };
}
