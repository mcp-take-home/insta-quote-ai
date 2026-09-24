import type { Evidence, ExtractedItem, Refusal, SourcedNumber, SourcedText } from "@insta-quote/shared";
import { extractPdfPages, groupIntoRows, type PdfRow, type PdfTextItem } from "./pdf";

type Column = "item" | "description" | "quantity" | "unit" | "unitPrice" | "lineTotal" | "weight";
type Header = { y: number; starts: Partial<Record<Column, number>>; hasLineTotal: boolean };
type Metadata = Partial<Record<"companyName" | "documentType" | "documentNumber" | "deliveredTo" | "orderedBy" | "disclaimer", SourcedText>>;
type Classification = { items: ExtractedItem[]; refusals: Refusal[]; total?: SourcedNumber };
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

export function extractMetadata(pages: Array<{ pageNumber: number; rows: PdfRow[] }>): Metadata {
  const metadata: Metadata = {};
  const firstPage = contentRows(pages.find((page) => page.pageNumber === 1)?.rows ?? []);
  const firstRow = firstPage[0];
  const first = firstRow ? context(firstRow) : "";
  if (firstRow && /^(?:company\s*:\s*.+|.+\b(?:ltd\.?|limited|pty\.?|inc\.?|corp\.?))$/i.test(first)) {
    metadata.companyName = sourcedRow(firstRow, first.replace(/^company\s*:\s*/i, ""));
  }
  const second = firstPage[1];
  if (second) {
    const value = context(second);
    if (/^(?:packing\s+list|invoice|delivery\s+docket|multi-site\s+delivery\s+run\b)/i.test(value)) metadata.documentType = sourcedRow(second, value);
  }

  for (const { rows } of pages) for (const row of contentRows(rows)) {
    const text = context(row);
    const labeled: Array<[keyof Metadata, RegExp]> = [
      ["documentNumber", /^document\s*(?:no\.?|number)\s*[:#]\s*(.+)$/i],
      ["deliveredTo", /^delivered\s+to\s*:\s*(.+)$/i],
      ["orderedBy", /^ordered\s+by\s*:\s*(.+)$/i],
    ];
    for (const [key, pattern] of labeled) {
      const match = text.match(pattern);
      if (!metadata[key] && match?.[1]?.trim()) metadata[key] = sourcedRow(row, match[1].trim());
    }
    const disclaimer = text.match(/^disclaimer\s*:\s*(.+)$/i);
    if (!metadata.disclaimer && disclaimer?.[1]?.trim()) metadata.disclaimer = sourcedRow(row, disclaimer[1].trim());
  }

  return metadata;
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

function refusal(code: string, message: string, row: PdfRow): Refusal {
  return { code, message, page: row.pageNumber, line: row.lineNumber, sourceText: context(row) };
}

export function documentTotalContradicts(total: SourcedNumber, items: ExtractedItem[], scopeKnown: boolean, complete: boolean): boolean {
  return scopeKnown && complete && Math.abs(items.reduce((sum, item) => sum + item.lineTotal.value, 0) - total.value) > 0.010001;
}

export function multiPageTotalRefusal(total: SourcedNumber, pageCount: number): Refusal | undefined {
  if (pageCount <= 1) return;
  return {
    code: "UNVERIFIABLE_VALUE",
    message: "This stated total cannot be reconciled because the document spans multiple pages and its page scope is unclear.",
    page: total.evidence.page,
    line: total.evidence.line,
    sourceText: total.evidence.sourceText,
    contextText: total.evidence.contextText,
  };
}

export function classifyRows(rows: PdfRow[]): Classification {
  const header = findHeader(rows);
  if (!header) {
    const refusals = rows.flatMap((row) => {
      const first = row.tokens.find((token) => clean(token) !== "");
      return first && /^\d+[.)]?$/.test(clean(first)) && row.tokens.some((token) => clean(token).length > 1)
        ? [refusal("COLUMN_AMBIGUITY", "This page appears to contain item rows, but its table columns could not be identified safely.", row)]
        : [];
    });
    return { items: [], refusals };
  }
  const items: ExtractedItem[] = [];
  const refusals: Refusal[] = [];
  let total: SourcedNumber | undefined;

  for (const row of rows) {
    if (row.y >= header.y) continue;
    const allText = context(row);
    if (/^Total\s*:?\s*.+$/i.test(allText)) {
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
        refusals.push(refusal("INVALID_ITEM_NUMBER", "This line has item details, but its item number is missing or unclear, so it was not extracted.", row));
        continue;
      }
      if (!description && valueCellCount >= 2) {
        refusals.push(refusal("UNVERIFIABLE_VALUE", "This line contains several numeric values but has no clear item number or description, so it could not be checked safely.", row));
        continue;
      }
      continue;
    }

    const fail = (code: string, message: string) => refusals.push(refusal(code, message, row));
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
  return { items, refusals, ...(total ? { total } : {}) };
}

const excludedPage = /\b(summary|returns? note|credit adjustment|signed acceptance|acceptance)\b/i;

export async function extractDocument(buffer: ArrayBuffer): Promise<{ items: ExtractedItem[]; refusals: Refusal[]; metadata: Metadata }> {
  const pages = await extractPdfPages(buffer);
  const items: ExtractedItem[] = [];
  const refusals: Refusal[] = [];
  const totals: PageTotal[] = [];
  const readablePageText: Array<{ pageNumber: number; text: string }> = [];
  const metadataPages: Array<{ pageNumber: number; rows: PdfRow[] }> = [];

  for (const page of pages) {
    const printable = page.items.filter((token) => clean(token) !== "");
    if (page.error || printable.length === 0) {
      refusals.push({ code: "UNREADABLE_CONTENT", message: "This page has no readable text, so its contents could not be checked.", page: page.pageNumber });
      continue;
    }
    const rows = contentRows(groupIntoRows(page.pageNumber, printable));
    if (rows.length === 0) {
      refusals.push({ code: "UNREADABLE_CONTENT", message: "This page has no readable text, so its contents could not be checked.", page: page.pageNumber });
      continue;
    }
    metadataPages.push({ pageNumber: page.pageNumber, rows });
    const text = rows.map(context).join(" ");
    readablePageText.push({ pageNumber: page.pageNumber, text });
    const heading = rows.slice(0, 6).map(context).join(" ");
    if (excludedPage.test(heading)) {
      const message = /summary/i.test(heading)
        ? "This summary page repeats delivery information, so its rows were skipped to avoid counting the same items twice."
        : "This returns, credit, or acceptance page repeats delivery lines in a different context, so its rows were skipped to avoid counting them as new items.";
      const sourceRow = rows.slice(0, 6).find((row) => excludedPage.test(context(row)));
      refusals.push({ code: "UNVERIFIABLE_VALUE", message, page: page.pageNumber, ...(sourceRow ? { line: sourceRow.lineNumber } : {}), sourceText: sourceRow ? context(sourceRow) : heading });
      continue;
    }
    const result = classifyRows(rows);
    items.push(...result.items);
    refusals.push(...result.refusals);
    if (result.total) totals.push({ value: result.total, items: result.items, complete: result.refusals.length === 0 });
  }

  const palletNotes = readablePageText.flatMap((page) => {
    const depot = page.text.match(/(\d+)\s+pallets?\s+loaded at depot/i);
    const site = page.text.match(/(\d+)\s+pallets?\s+unloaded at site/i);
    if (!depot || !site || depot[1] === site[1]) return [];
    const rows = metadataPages.find((entry) => entry.pageNumber === page.pageNumber)?.rows ?? [];
    const depotRow = rows.find((candidate) => context(candidate).includes(depot[0]));
    const siteRow = rows.find((candidate) => context(candidate).includes(site[0]));
    return [{ pageNumber: page.pageNumber, lines: [...new Set([depotRow?.lineNumber, siteRow?.lineNumber].filter((line): line is number => line !== undefined))], depot: depot[0], site: site[0] }];
  });
  for (const note of palletNotes) refusals.push({ code: "CONFLICTING_VALUES", message: "The pallet counts in the depot and site notes do not agree; please check the delivery record.", page: note.pageNumber, ...(note.lines.length ? { lines: note.lines } : {}), sourceText: `${note.depot}; ${note.site}` });

  for (const documentTotal of totals) {
    const multiPageRefusal = multiPageTotalRefusal(documentTotal.value, pages.length);
    if (multiPageRefusal) {
      refusals.push(multiPageRefusal);
      continue;
    }
    if (documentTotalContradicts(documentTotal.value, documentTotal.items, pages.length === 1, documentTotal.complete)) {
      refusals.push({ code: "ARITHMETIC_CONTRADICTION", message: "The stated document total does not match the sum of the verified line totals.", page: documentTotal.value.evidence.page, line: documentTotal.value.evidence.line, sourceText: documentTotal.value.evidence.sourceText, contextText: documentTotal.value.evidence.contextText });
      break;
    }
  }

  return { items, refusals, metadata: extractMetadata(metadataPages) };
}
