import type { ExtractedItem, Refusal, SourcedNumber } from "@insta-quote/shared";
import { extractPdfPages, groupIntoRows, type PdfRow, type PdfTextItem } from "./pdf";

type Column = "item" | "description" | "quantity" | "unit" | "unitPrice" | "lineTotal" | "weight";
type Header = { y: number; starts: Partial<Record<Column, number>>; hasLineTotal: boolean };
type Classification = { items: ExtractedItem[]; refusals: Refusal[]; total?: SourcedNumber };
type PageTotal = { value: SourcedNumber; items: ExtractedItem[]; complete: boolean };

const labels: Array<[Column, RegExp]> = [
  ["item", /^item(?:\s|$)/i], ["description", /^(?:description|product|details)$/i],
  ["quantity", /^(?:qty|quantity)$/i], ["unit", /^unit$/i], ["unitPrice", /^(?:unit\s*price|price)$/i],
  ["lineTotal", /^(?:line\s*total|amount)$/i], ["weight", /^weight$/i],
];

function clean(token: PdfTextItem): string { return token.text.trim(); }
function context(row: PdfRow): string { return row.tokens.map(clean).filter(Boolean).join(" "); }

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
  return { value, evidence: { page, sourceText: token.text, contextText: context(row) } };
}

function refusal(code: string, message: string, row: PdfRow): Refusal {
  return { code, message, page: row.pageNumber, sourceText: context(row) };
}

export function documentTotalContradicts(total: SourcedNumber, items: ExtractedItem[], complete: boolean): boolean {
  return complete && Math.abs(items.reduce((sum, item) => sum + item.lineTotal.value, 0) - total.value) > 0.010001;
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
    const itemCell = cellTokens(row, header, "item");
    const description = cellTokens(row, header, "description").map(clean).filter(Boolean).join(" ");
    const candidateItem = itemCell.length > 0 && /^\d+[.)]?$/.test(clean(itemCell[0]!));
    if (!candidateItem) {
      const hasLineValues = description && (["quantity", "unitPrice", "lineTotal"] as Column[]).some((column) => cellTokens(row, header, column).length > 0);
      if (hasLineValues) {
        refusals.push(refusal("INVALID_ITEM_NUMBER", "This line has item details, but its item number is missing or unclear, so it was not extracted.", row));
        continue;
      }
      const allText = context(row);
      const totalMatch = allText.match(/^Total\s*:?\s*(.+)$/i);
      if (totalMatch) {
        const source = row.tokens.find((token) => /^(?:NZ\s*)?\$?\s*\d/i.test(clean(token)));
        total = parseNumber(source, "money", row.pageNumber, row);
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
    items.push({ description, quantity, unitPrice, lineTotal });
  }
  return { items, refusals, ...(total ? { total } : {}) };
}

const excludedPage = /\b(summary|returns? note|credit adjustment|signed acceptance|acceptance)\b/i;

export async function extractDocument(buffer: ArrayBuffer): Promise<{ items: ExtractedItem[]; refusals: Refusal[] }> {
  const pages = await extractPdfPages(buffer);
  const items: ExtractedItem[] = [];
  const refusals: Refusal[] = [];
  const totals: PageTotal[] = [];
  const readablePageText: Array<{ pageNumber: number; text: string }> = [];

  for (const page of pages) {
    const printable = page.items.filter((token) => clean(token) !== "" && !clean(token).startsWith("-----------"));
    if (page.error || printable.length === 0) {
      refusals.push({ code: "UNREADABLE_CONTENT", message: "This page has no readable text, so its contents could not be checked.", page: page.pageNumber });
      continue;
    }
    const rows = groupIntoRows(page.pageNumber, printable);
    const text = rows.map(context).join(" ");
    readablePageText.push({ pageNumber: page.pageNumber, text });
    const heading = rows.slice(0, 6).map(context).join(" ");
    if (excludedPage.test(heading)) {
      const message = /summary/i.test(heading)
        ? "This summary page repeats delivery information, so its rows were skipped to avoid counting the same items twice."
        : "This returns, credit, or acceptance page repeats delivery lines in a different context, so its rows were skipped to avoid counting them as new items.";
      refusals.push({ code: "UNVERIFIABLE_VALUE", message, page: page.pageNumber, sourceText: heading });
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
    return depot && site && depot[1] !== site[1] ? [{ pageNumber: page.pageNumber, depot: depot[0], site: site[0] }] : [];
  });
  for (const note of palletNotes) refusals.push({ code: "CONFLICTING_VALUES", message: "The pallet counts in the depot and site notes do not agree; please check the delivery record.", page: note.pageNumber, sourceText: `${note.depot}; ${note.site}` });

  for (const documentTotal of totals) {
    if (documentTotalContradicts(documentTotal.value, documentTotal.items, documentTotal.complete)) {
      refusals.push({ code: "ARITHMETIC_CONTRADICTION", message: "The stated document total does not match the sum of the verified line totals.", page: documentTotal.value.evidence.page, sourceText: documentTotal.value.evidence.sourceText, contextText: documentTotal.value.evidence.contextText });
      break;
    }
  }

  return { items, refusals };
}
