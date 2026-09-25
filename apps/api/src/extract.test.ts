import { describe, expect, test } from "bun:test";
import { classifyRows, documentTotalContradicts, extractDetails, extractDocument, multiPageTotalNote } from "./extract";
import type { PdfRow } from "./pdf";

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

  test("refuses unnumbered numeric rows but ignores a footer with only a line total", () => {
    const rows = fixture();
    rows[1]!.tokens.splice(0, 2);
    expect(classifyRows(rows).items[0]?.error?.code).toBe("UNVERIFIABLE_VALUE");

    const footer = [...fixture(), row(2, 60, [[43, "Total:"], [502, "$10.00"]])];
    const result = classifyRows(footer);
    expect(result.total?.value).toBe(10);
  });

  test("checks a document total only for a single-page document with complete items", () => {
    const item = classifyRows(fixture()).items[0]!;
    const stated = { value: 100, evidence: { page: 2, sourceText: "$100.00" } };
    expect(documentTotalContradicts(stated, [item], false, true)).toBe(false);
    expect(documentTotalContradicts(stated, [item], true, false)).toBe(false);
    expect(documentTotalContradicts(stated, [item], true, true)).toBe(true);
  });

  test("explains why a multi-page stated total cannot be reconciled", () => {
    const total = { value: 100, evidence: { page: 3, sourceText: "$100.00", contextText: "Total: $100.00" } };
    const note = multiPageTotalNote(total, 3);
    expect(note?.error?.code).toBe("UNVERIFIABLE_VALUE");
    expect(note?.value).toMatch(/spans multiple pages/i);
    expect(note?.page).toBe(3);
    expect(multiPageTotalNote(total, 1)).toBeUndefined();
  });

  test("finds likely headerless item rows without treating numbered prose as items", () => {
    const rows = [row(1, 100, [[0, "1"], [20, "Timber"], [100, "2"], [140, "$5.00"]]), row(1, 80, [[0, "2026"], [30, "forecast for next year"]])];
    const result = classifyRows(rows);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.error?.code).toBe("COLUMN_AMBIGUITY");
  });
});

test("collects all non-table labels and notes with full source evidence", () => {
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
  expect(extracted.details.Total).toBeUndefined();
  expect(extracted.details["Document Total"]).toBeUndefined();
  expect(extracted.details["__proto__"]?.[0]?.value).toBe("safe");
  expect(extracted.details["constructor"]?.[0]?.value).toBe("also safe");
  expect(extracted.notes).toMatchObject([
    { value: "Acme Ltd", evidence: { line: 2 } },
    { value: "Packing List", evidence: { line: 4 } },
  ]);
});

const sampleNames = ["KBS-10234", "KBS-10241", "KBS-10255", "KBS-10262", "KBS-10270", "KBS-DR118"];
const sample = (name: string) => Bun.file(new URL(`../../../../data/${name}.pdf`, import.meta.url));
const sampleDataAvailable = (await Promise.all(sampleNames.map((name) => sample(name).exists()))).every(Boolean);

test.skipIf(!sampleDataAvailable)("extractDocument extracts dynamic details and reports document contradictions", async () => {
  const result = await extractDocument(await sample("KBS-10270").arrayBuffer());
  expect(result.items).toHaveLength(4);
  expect(result.details).toMatchObject({ "Document No": [{ value: "KBS-10270", evidence: { page: 1, line: 3 } }], "Delivered to": [{ value: "Site 6, Matai Grove" }], "Ordered by": [{ value: "S. Prasad" }] });
  expect(result.notes[0]).toMatchObject({ value: "Kowhai Building Supplies Ltd", evidence: { page: 1, line: 1 } });
  expect(result.items.every((item) => item.evidence.line && item.quantity?.evidence.line && item.unitPrice?.evidence.line && item.lineTotal?.evidence.line)).toBe(true);
  expect(result.notes.some((note) => note.error?.code === "ARITHMETIC_CONTRADICTION" && note.page === 1)).toBe(true);

  const unreadable = await extractDocument(await sample("KBS-10241").arrayBuffer());
  expect(unreadable.items).toHaveLength(0);
  expect(unreadable.notes[0]).toMatchObject({ error: { code: "UNREADABLE_CONTENT" }, page: 1 });

  const noTotals = await extractDocument(await sample("KBS-10255").arrayBuffer());
  expect(noTotals.items).toHaveLength(4);
  expect(noTotals.items.every((item) => item.error?.code === "MISSING_LINE_TOTAL" && item.quantity && item.unitPrice && !item.lineTotal)).toBe(true);
  expect(noTotals.details.Note?.[0]?.value).toMatch(/weight figures/i);

  const palletConflict = await extractDocument(await sample("KBS-10262").arrayBuffer());
  expect(palletConflict.items).toHaveLength(3);
  expect(palletConflict.notes.find((note) => note.error?.code === "CONFLICTING_VALUES")).toMatchObject({ page: 1, lines: [7, 13] });

  const deliveryRun = await extractDocument(await sample("KBS-DR118").arrayBuffer());
  expect(deliveryRun.items).toHaveLength(21);
  const acceptedRunItems = deliveryRun.items.filter((item) => item.evidence.page <= 3);
  const refusedRunItems = deliveryRun.items.filter((item) => item.evidence.page >= 5 && item.evidence.page <= 8);
  expect(acceptedRunItems).toHaveLength(9);
  expect(refusedRunItems).toHaveLength(12);
  expect(refusedRunItems.every((item) => item.description && item.evidence.line && item.evidence.sourceText && item.error?.message && !item.quantity && !item.unitPrice && !item.lineTotal)).toBe(true);
  expect(deliveryRun.notes).toContainEqual(expect.objectContaining({ value: "Multi-Site Delivery Run 118 - Site 1 of 4 - Ranfurly Ave", evidence: { page: 1, line: 2, sourceText: "Multi-Site Delivery Run 118 - Site 1 of 4 - Ranfurly Ave" } }));
  expect(deliveryRun.notes.filter((note) => note.error?.code === "UNVERIFIABLE_VALUE").every((note) => note.line === 2)).toBe(true);
  expect(deliveryRun.notes.filter((note) => note.error?.code === "UNVERIFIABLE_VALUE").every((note) => note.sourceText?.startsWith("Multi-Site Delivery Run"))).toBe(true);
  expect(deliveryRun.notes.filter((note) => note.error?.code === "UNREADABLE_CONTENT")).toHaveLength(1);
  expect(deliveryRun.notes.filter((note) => note.error?.code === "UNVERIFIABLE_VALUE")).toHaveLength(4);
});
