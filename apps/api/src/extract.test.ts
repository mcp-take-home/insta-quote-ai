import { describe, expect, test } from "bun:test";
import { classifyRows, documentTotalContradicts, extractDocument, multiPageTotalRefusal } from "./extract";
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

describe("classifyRows refusal boundary", () => {
  test("refuses missing and malformed required numeric fields", () => {
    expect(classifyRows(fixture({ qty: null })).refusals[0]?.code).toBe("MISSING_QUANTITY");
    expect(classifyRows(fixture({ qty: "many" })).refusals[0]?.code).toBe("INVALID_QUANTITY");
    expect(classifyRows(fixture({ price: null })).refusals[0]?.code).toBe("MISSING_UNIT_PRICE");
    expect(classifyRows(fixture({ price: "about $20" })).refusals[0]?.code).toBe("INVALID_UNIT_PRICE");
    expect(classifyRows(fixture({ total: null })).refusals[0]?.code).toBe("MISSING_LINE_TOTAL");
    expect(classifyRows(fixture({ total: "unknown" })).refusals[0]?.code).toBe("INVALID_LINE_TOTAL");
  });

  test("keeps exact source evidence and refuses unsupported or contradictory values", () => {
    const sourced = classifyRows(fixture({ qty: "2", price: "$5.00", total: "$10.00" }));
    expect(sourced.items[0]?.quantity.evidence.sourceText).toBe("2");
    expect(sourced.items[0]?.quantity.evidence.page).toBe(2);
    expect(sourced.items[0]?.quantity.evidence.line).toBe(2);
    expect(sourced.items[0]?.evidence).toMatchObject({ page: 2, line: 2, sourceText: "Timber" });
    expect(classifyRows(fixture({ qty: "2", price: "$5.00 approx", total: "$10.00" })).refusals[0]?.code).toBe("INVALID_UNIT_PRICE");
    const contradiction = classifyRows(fixture({ qty: "2", price: "$5.00", total: "$9.00" }));
    expect(contradiction.refusals[0]?.code).toBe("ARITHMETIC_CONTRADICTION");
    expect(contradiction.refusals[0]?.message).toMatch(/do not match/i);
  });

  test("requires a stated total column and preserves valid rows around a bad row", () => {
    expect(classifyRows(fixture({ totalColumn: false, qty: "2", price: "$5.00", total: "$10.00" })).refusals[0]?.code).toBe("MISSING_LINE_TOTAL");
    const rows = fixture({ qty: "2", price: "$5.00", total: "$10.00" });
    rows.push(row(2, 60, [[43, "2"], [71, "Broken row"], [326, "bad"], [377, "ea"], [428, "$3.00"], [502, "$3.00"]]));
    rows.push(row(2, 40, [[43, "3"], [71, "Still good"], [326, "3"], [377, "ea"], [428, "$4.00"], [502, "$12.00"]]));
    const result = classifyRows(rows);
    expect(result.items).toHaveLength(2);
    expect(result.refusals).toHaveLength(1);
  });

  test("refuses values that cannot be assigned to one column", () => {
    const rows = fixture();
    rows[1]!.tokens.push({ text: "3", x: 340, y: 80, width: 5, height: 10 });
    expect(classifyRows(rows).refusals[0]?.code).toBe("COLUMN_AMBIGUITY");
  });

  test("refuses a likely line item when its item number is absent or malformed", () => {
    const rows = fixture();
    rows[1]!.tokens[0]!.text = "abc";
    expect(classifyRows(rows).refusals[0]?.code).toBe("INVALID_ITEM_NUMBER");

    const missingNumber = fixture();
    missingNumber[1]!.tokens.splice(0, 1);
    expect(classifyRows(missingNumber).refusals[0]?.code).toBe("INVALID_ITEM_NUMBER");
  });

  test("refuses unnumbered numeric rows but ignores a footer with only a line total", () => {
    const rows = fixture();
    rows[1]!.tokens.splice(0, 2);
    expect(classifyRows(rows).refusals[0]?.code).toBe("UNVERIFIABLE_VALUE");

    const footer = [...fixture(), row(2, 60, [[43, "Total:"], [502, "$10.00"]])];
    const result = classifyRows(footer);
    expect(result.refusals).toHaveLength(0);
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
    const refusal = multiPageTotalRefusal(total, 3);
    expect(refusal?.code).toBe("UNVERIFIABLE_VALUE");
    expect(refusal?.message).toMatch(/spans multiple pages/i);
    expect(refusal?.page).toBe(3);
    expect(multiPageTotalRefusal(total, 1)).toBeUndefined();
  });
});

const sampleNames = ["KBS-10234", "KBS-10241", "KBS-10255", "KBS-10262", "KBS-10270", "KBS-DR118"];
const sample = (name: string) => Bun.file(new URL(`../../../../data/${name}.pdf`, import.meta.url));
const sampleDataAvailable = (await Promise.all(sampleNames.map((name) => sample(name).exists()))).every(Boolean);

test.skipIf(!sampleDataAvailable)("extractDocument keeps good pages and reports sample document contradictions", async () => {
  const result = await extractDocument(await sample("KBS-10270").arrayBuffer());
  expect(result.items).toHaveLength(4);
  expect(result.metadata).toMatchObject({
    companyName: { value: "Kowhai Building Supplies Ltd", evidence: { page: 1, line: 1 } },
    documentType: { value: "Packing List", evidence: { page: 1, line: 2 } },
    documentNumber: { value: "KBS-10270", evidence: { page: 1, line: 3 } },
    deliveredTo: { value: "Site 6, Matai Grove", evidence: { page: 1, line: 5 } },
    orderedBy: { value: "S. Prasad", evidence: { page: 1, line: 6 } },
    disclaimer: { value: "Freight and handling included where applicable.", evidence: { page: 1, line: 14 } },
  });
  expect(result.items.every((item) => item.evidence?.line && item.quantity.evidence.line && item.unitPrice.evidence.line && item.lineTotal.evidence.line)).toBe(true);
  expect(result.refusals.some((refusal) => refusal.code === "ARITHMETIC_CONTRADICTION")).toBe(true);

  const unreadable = await extractDocument(await sample("KBS-10241").arrayBuffer());
  expect(unreadable.items).toHaveLength(0);
  expect(unreadable.refusals[0]?.code).toBe("UNREADABLE_CONTENT");
  expect(unreadable.refusals[0]?.page).toBe(1);

  const noTotals = await extractDocument(await sample("KBS-10255").arrayBuffer());
  expect(noTotals.items).toHaveLength(0);
  expect(noTotals.refusals.filter((refusal) => refusal.code === "MISSING_LINE_TOTAL")).toHaveLength(4);
  expect(noTotals.refusals.filter((refusal) => refusal.code === "MISSING_LINE_TOTAL").every((refusal) => refusal.line !== undefined)).toBe(true);

  const palletConflict = await extractDocument(await sample("KBS-10262").arrayBuffer());
  expect(palletConflict.items).toHaveLength(3);
  expect(palletConflict.refusals.find((refusal) => refusal.code === "CONFLICTING_VALUES")).toMatchObject({ page: 1, lines: [7, 13] });

  const deliveryRun = await extractDocument(await sample("KBS-DR118").arrayBuffer());
  expect(deliveryRun.items).toHaveLength(9);
  expect(deliveryRun.metadata).toMatchObject({ documentType: { value: "Multi-Site Delivery Run 118 - Site 1 of 4 - Ranfurly Ave", evidence: { page: 1, line: 2 } } });
  expect(deliveryRun.metadata.deliveredTo).toBeUndefined();
  expect(deliveryRun.metadata.orderedBy).toBeUndefined();
  expect(deliveryRun.refusals.filter((refusal) => refusal.code === "UNVERIFIABLE_VALUE").every((refusal) => refusal.line === 2)).toBe(true);
  expect(deliveryRun.refusals.filter((refusal) => refusal.code === "UNREADABLE_CONTENT")).toHaveLength(1);
  expect(deliveryRun.refusals.filter((refusal) => refusal.code === "UNVERIFIABLE_VALUE")).toHaveLength(4);
});
