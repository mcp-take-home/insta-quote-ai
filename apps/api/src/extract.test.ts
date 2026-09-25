import { describe, expect, test } from "bun:test";
import { classifyRows, extractDetails, extractDocument } from "./extract";
import { DocumentResponseSchema } from "@insta-quote/shared";
import { extractPdfPages, type PdfRow } from "./pdf";

function row(pageNumber: number, y: number, cells: Array<[number, string]>): PdfRow {
  return {
    pageNumber,
    lineNumber: Math.round((100 - y) / 20) + 1,
    y,
    tokens: cells.map(([x, text]) => ({ text, x, y, width: text.length * 5, height: 10 })),
  };
}

function fixture(options: { qty?: string | null; price?: string | null; total?: string | null; totalColumn?: boolean } = {}): PdfRow[] {
  const headers: Array<[number, string]> = [[43, "Item"], [71, "Description"], [326, "Qty"], [377, "Unit"], [428, "Unit Price"]];
  if (options.totalColumn !== false) headers.push([502, "Line Total"]);
  const rows = [row(2, 100, headers)];
  rows.push(row(2, 80, [[43, "1"], [71, "Timber"], ...(options.qty === null ? [] : [[326, options.qty ?? "2"] as [number, string]]), [377, "length"], ...(options.price === null ? [] : [[428, options.price ?? "$5.00"] as [number, string]]), ...(options.total === null ? [] : [[502, options.total ?? "$10.00"] as [number, string]])]));
  return rows;
}

describe("classifyRows inline row errors", () => {
  test("keeps missing and malformed values on item rows", () => {
    expect(classifyRows(fixture({ qty: null })).items[0]?.error?.code).toBe("MISSING_QUANTITY");
    expect(classifyRows(fixture({ qty: "many" })).items[0]?.error?.code).toBe("INVALID_QUANTITY");
    expect(classifyRows(fixture({ price: null })).items[0]?.error?.code).toBe("MISSING_UNIT_PRICE");
    expect(classifyRows(fixture({ price: "about $20" })).items[0]?.error?.code).toBe("INVALID_UNIT_PRICE");
    expect(classifyRows(fixture({ total: null })).items[0]?.error?.code).toBe("MISSING_LINE_TOTAL");
    expect(classifyRows(fixture({ total: "unknown" })).items[0]?.error?.code).toBe("INVALID_LINE_TOTAL");
  });

  test("keeps exact source evidence and refuses unsupported or contradictory values", () => {
    const sourced = classifyRows(fixture({ qty: "2", price: "$5.00", total: "$10.00" }));
    expect(sourced.items[0]?.quantity?.evidence.sourceText).toBe("2");
    expect(sourced.items[0]?.quantity?.evidence.page).toBe(2);
    expect(sourced.items[0]?.quantity?.evidence.line).toBe(2);
    expect(sourced.items[0]?.evidence).toMatchObject({ page: 2, line: 2, sourceText: "Timber" });
    expect(classifyRows(fixture({ qty: "2", price: "$5.00 approx", total: "$10.00" })).items[0]?.error?.code).toBe("INVALID_UNIT_PRICE");
    const contradiction = classifyRows(fixture({ qty: "2", price: "$5.00", total: "$9.00" }));
    expect(contradiction.items[0]?.error?.code).toBe("ARITHMETIC_CONTRADICTION");
    expect(contradiction.items[0]?.error?.message).toMatch(/do not match/i);
  });

  test("requires a stated total column and preserves valid rows around a bad row", () => {
    expect(classifyRows(fixture({ totalColumn: false, qty: "2", price: "$5.00", total: "$10.00" })).items[0]?.error?.code).toBe("MISSING_LINE_TOTAL");
    const rows = fixture({ qty: "2", price: "$5.00", total: "$10.00" });
    rows.push(row(2, 60, [[43, "2"], [71, "Broken row"], [326, "bad"], [377, "ea"], [428, "$3.00"], [502, "$3.00"]]));
    rows.push(row(2, 40, [[43, "3"], [71, "Still good"], [326, "3"], [377, "ea"], [428, "$4.00"], [502, "$12.00"]]));
    const result = classifyRows(rows);
    expect(result.items).toHaveLength(3);
    expect(result.items[1]?.error?.code).toBe("INVALID_QUANTITY");
    expect(result.items.some((item) => !item.error)).toBe(true);
  });

  test("refuses values that cannot be assigned to one column", () => {
    const rows = fixture();
    rows[1]!.tokens.push({ text: "3", x: 340, y: 80, width: 5, height: 10 });
    expect(classifyRows(rows).items[0]?.error?.code).toBe("COLUMN_AMBIGUITY");
  });

  test("refuses a likely line item when its item number is absent or malformed", () => {
    const rows = fixture();
    rows[1]!.tokens[0]!.text = "abc";
    expect(classifyRows(rows).items[0]?.error?.code).toBe("INVALID_ITEM_NUMBER");

    const missingNumber = fixture();
    missingNumber[1]!.tokens.splice(0, 1);
    expect(classifyRows(missingNumber).items[0]?.error?.code).toBe("INVALID_ITEM_NUMBER");
  });

  test("refuses unnumbered numeric rows and leaves a total footer for details", () => {
    const rows = fixture();
    rows[1]!.tokens.splice(0, 2);
    expect(classifyRows(rows).items[0]?.error?.code).toBe("UNVERIFIABLE_VALUE");

    const footer = [...fixture(), row(2, 60, [[43, "Total:"], [502, "$10.00"]])];
    const result = classifyRows(footer);
    expect(result.items).toHaveLength(1);
    expect(result.tableLines.has(footer[2]!.lineNumber)).toBe(false);
    expect(extractDetails([{ pageNumber: 2, rows: footer, tableLines: result.tableLines }]).details.Total?.[0]?.value).toBe("$10.00");
  });

  test("finds likely headerless item rows without treating numbered prose as items", () => {
    const rows = [row(1, 100, [[0, "1"], [20, "Timber"], [100, "2"], [140, "$5.00"]]), row(1, 80, [[0, "2026"], [30, "forecast for next year"]])];
    const result = classifyRows(rows);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.error?.code).toBe("COLUMN_AMBIGUITY");
  });
});

test("collects all non-table text as details with full source evidence", () => {
  const extracted = extractDetails([{ pageNumber: 1, rows: [
    row(1, 100, [[0, "-----------"]]),
    row(1, 80, [[0, "Acme Ltd"]]),
    row(1, 60, [[0, "-----------"]]),
    row(1, 40, [[0, "Packing List"]]),
    row(1, 20, [[0, "Note: count checked on arrival."]]),
    row(1, -10, [[0, "Reference: first"]]),
    row(1, -20, [[0, "Reference: second"]]),
    row(1, -30, [[0, "Total: $100.00"]]),
    row(1, -40, [[0, "Total: NZ$ 100.00"]]),
    row(1, -50, [[0, "Document Total: USD 100.00"]]),
    row(1, -60, [[0, "__proto__: safe"]]),
    row(1, -70, [[0, "constructor: also safe"]]),
    row(1, 0, [[0, "Disclaimer: Quantities subject to final verification."]]),
  ] }]);
  expect(extracted.details.Disclaimer).toMatchObject([{ value: "Quantities subject to final verification.", evidence: { page: 1, line: 6, sourceText: "Disclaimer: Quantities subject to final verification." } }]);
  expect(extracted.details.Reference?.map(({ value }) => value)).toEqual(["first", "second"]);
  expect(extracted.details.Total?.map((entry) => entry.value)).toEqual(["$100.00", "NZ$ 100.00"]);
  expect(extracted.details["Document Total"]?.[0]?.value).toBe("USD 100.00");
  expect(extracted.details["__proto__"]?.[0]?.value).toBe("safe");
  expect(extracted.details["constructor"]?.[0]?.value).toBe("also safe");
  expect(extracted.details.Text).toMatchObject([
    { value: "Acme Ltd", evidence: { line: 2 } },
    { value: "Packing List", evidence: { line: 4 } },
  ]);
  expect(extracted.notes).toEqual([]);
});

test("keeps non-table details on each source page, including repeated text and totals", () => {
  const pages = [1, 2].map((pageNumber) => ({ pageNumber, rows: [
    row(pageNumber, 100, [[0, "Kowhai Building Supplies Ltd"]]),
    row(pageNumber, 80, [[0, "Document No: KBS-DR118"]]),
    row(pageNumber, 60, [[0, "Total: $100.00"]]),
    row(pageNumber, 40, [[0, `Page ${pageNumber} of 2`]]),
  ] }));
  const result = extractDetails(pages);
  expect(result.details["Document No"]?.map((entry) => entry.evidence.page)).toEqual([1, 2]);
  expect(result.details.Total?.map((entry) => entry.evidence.page)).toEqual([1, 2]);
  expect(result.details.Text?.map((entry) => [entry.value, entry.evidence.page])).toEqual([
    ["Kowhai Building Supplies Ltd", 1], ["Page 1 of 2", 1],
    ["Kowhai Building Supplies Ltd", 2], ["Page 2 of 2", 2],
  ]);
  expect(result.notes).toEqual([]);
});

const sampleNames = ["KBS-10234", "KBS-10241", "KBS-10255", "KBS-10262", "KBS-10270", "KBS-DR118"];
const sample = (name: string) => Bun.file(new URL(`../../../../data/${name}.pdf`, import.meta.url));
const sampleDataAvailable = (await Promise.all(sampleNames.map((name) => sample(name).exists()))).every(Boolean);

test.skipIf(!sampleDataAvailable)("extractDocument keeps items and page details for all supplied PDFs", async () => {
  const parsedSamples = await Promise.all(sampleNames.map(async (name, index) => DocumentResponseSchema.parse({ id: `sample-${index}`, status: "completed", ...await extractDocument(await sample(name).arrayBuffer()) })));
  expect(parsedSamples).toHaveLength(6);
  expect(parsedSamples[0]?.status === "completed" ? parsedSamples[0].items : []).toHaveLength(5);
  const result = await extractDocument(await sample("KBS-10270").arrayBuffer());
  expect(result.items).toHaveLength(4);
  expect(result.details).toMatchObject({ "Document No": [{ value: "KBS-10270", evidence: { page: 1, line: 3 } }], "Delivered to": [{ value: "Site 6, Matai Grove" }], "Ordered by": [{ value: "S. Prasad" }] });
  expect(result.details.Text?.[0]).toMatchObject({ value: "Kowhai Building Supplies Ltd", evidence: { page: 1, line: 1 } });
  expect(result.items.every((item) => item.evidence.line && item.quantity?.evidence.line && item.unitPrice?.evidence.line && item.lineTotal?.evidence.line)).toBe(true);
  expect(result.notes.some((note) => note.error?.code === "ARITHMETIC_CONTRADICTION")).toBe(false);

  const unreadable = await extractDocument(await sample("KBS-10241").arrayBuffer());
  expect(unreadable.items).toHaveLength(4);
  expect(unreadable.items.every((item) => item.evidence.page === 1 && item.error && !item.quantity && !item.unitPrice && !item.lineTotal)).toBe(true);
  expect(unreadable.items.map((item) => item.description)).toEqual([
    "Timber H3.2 90x45 framing 4.8m", "Timber H3.2 140x45 framing 4.8m", "Joist hangers 140mm galv", "Nail plates 100x100 galv",
  ]);

  const noTotals = await extractDocument(await sample("KBS-10255").arrayBuffer());
  expect(noTotals.items).toHaveLength(4);
  expect(noTotals.items.every((item) => item.error?.code === "MISSING_LINE_TOTAL" && item.quantity && item.unitPrice && !item.lineTotal)).toBe(true);
  expect(noTotals.details.Note?.[0]?.value).toMatch(/weight figures/i);

  const palletConflict = await extractDocument(await sample("KBS-10262").arrayBuffer());
  expect(palletConflict.items).toHaveLength(3);
  expect(palletConflict.notes.some((note) => note.error?.code === "CONFLICTING_VALUES")).toBe(false);

  const deliveryRun = await extractDocument(await sample("KBS-DR118").arrayBuffer());
  expect(deliveryRun.items).toHaveLength(24);
  expect(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, deliveryRun.items.filter((item) => item.evidence.page === index + 1).length]))).toEqual({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 });
  const ocrItems = [...unreadable.items, ...deliveryRun.items.filter((item) => item.evidence.page === 4)];
  expect(ocrItems.every((item) => item.error && !item.quantity && !item.unitPrice && !item.lineTotal)).toBe(true);
  expect(deliveryRun.items.filter((item) => item.evidence.page === 4).map((item) => item.description)).toEqual([
    "Framing timber lot 4-1", "Framing timber lot 4-2", "Framing timber lot 4-3",
  ]);
  expect(deliveryRun.details.Text).toContainEqual(expect.objectContaining({ value: "Multi-Site Delivery Run 118 - Site 1 of 4 - Ranfurly Ave", evidence: { page: 1, line: 2, sourceText: "Multi-Site Delivery Run 118 - Site 1 of 4 - Ranfurly Ave" } }));
  expect(deliveryRun.details["Document No"]?.map((entry) => entry.evidence.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(deliveryRun.details.Date?.map((entry) => entry.evidence.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(deliveryRun.details.Text?.filter((entry) => entry.value === "Kowhai Building Supplies Ltd").map((entry) => entry.evidence.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(deliveryRun.details.Text?.map((entry) => entry.value)).toContain("Multi-Site Delivery Run 118 - Site 2 of 4 - Ranfurly Ave");
  expect(deliveryRun.details.Text?.map((entry) => entry.value)).toContain("Multi-Site Delivery Run 118 - Site 3 of 4 - Beach Road");

  expect(deliveryRun.notes.filter((note) => note.error?.code === "UNREADABLE_CONTENT")).toHaveLength(0);
  expect(deliveryRun.notes.filter((note) => note.error?.code === "UNVERIFIABLE_VALUE" && /summary|returns|credit|acceptance/i.test(note.value))).toHaveLength(0);
}, 30_000);

test.skipIf(!sampleDataAvailable)("extractPdfPages loads installed standard fonts without warnings", async () => {
  const fontWarnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args.some((value) => String(value).includes("standardFontDataUrl"))) fontWarnings.push(args.map(String).join(" "));
    else originalWarn(...args);
  };

  try {
    const pages = await extractPdfPages(await sample("KBS-10234").arrayBuffer());
    expect(pages).toHaveLength(1);
    expect(pages[0]?.items.some((item) => item.text.includes("KBS-10234"))).toBe(true);
  } finally {
    console.warn = originalWarn;
  }

  expect(fontWarnings).toEqual([]);
});
