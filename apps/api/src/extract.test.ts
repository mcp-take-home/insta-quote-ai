import { describe, expect, test } from "bun:test";
import { classifyRows, extractDocument } from "./extract";
import type { PdfRow } from "./pdf";

function row(pageNumber: number, y: number, cells: Array<[number, string]>): PdfRow {
  return {
    pageNumber,
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
});

test("extractDocument keeps good pages and reports unreadable pages and document contradictions", async () => {
  const result = await extractDocument(await Bun.file("../data/KBS-10270.pdf").arrayBuffer());
  expect(result.items).toHaveLength(4);
  expect(result.refusals.some((refusal) => refusal.code === "ARITHMETIC_CONTRADICTION")).toBe(true);

  const unreadable = await extractDocument(await Bun.file("../data/KBS-10241.pdf").arrayBuffer());
  expect(unreadable.items).toHaveLength(0);
  expect(unreadable.refusals[0]?.code).toBe("UNREADABLE_CONTENT");
  expect(unreadable.refusals[0]?.page).toBe(1);

  const noTotals = await extractDocument(await Bun.file("../data/KBS-10255.pdf").arrayBuffer());
  expect(noTotals.items).toHaveLength(0);
  expect(noTotals.refusals.filter((refusal) => refusal.code === "MISSING_LINE_TOTAL")).toHaveLength(4);

  const palletConflict = await extractDocument(await Bun.file("../data/KBS-10262.pdf").arrayBuffer());
  expect(palletConflict.items).toHaveLength(3);
  expect(palletConflict.refusals.some((refusal) => refusal.code === "CONFLICTING_VALUES")).toBe(true);

  const deliveryRun = await extractDocument(await Bun.file("../data/KBS-DR118.pdf").arrayBuffer());
  expect(deliveryRun.items).toHaveLength(9);
  expect(deliveryRun.refusals.filter((refusal) => refusal.code === "UNREADABLE_CONTENT")).toHaveLength(1);
  expect(deliveryRun.refusals.filter((refusal) => refusal.code === "UNVERIFIABLE_VALUE")).toHaveLength(4);
});
