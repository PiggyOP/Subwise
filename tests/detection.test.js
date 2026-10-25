import test from "node:test";
import assert from "node:assert/strict";
import { detectRecurring } from "../server/detection.js";
const tx = (date, merchant = "NETFLIX", amount = 64900) => ({
  date,
  merchant,
  amount,
});
test("recognises monthly statement patterns with evidence", () => {
  const r = detectRecurring([
    tx("2026-07-05"),
    tx("2026-08-05"),
    tx("2026-09-05"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "Netflix");
  assert.equal(r[0].cadence, "monthly");
  assert.equal(r[0].nextDate, "2026-10-05");
});
test("rejects a single purchase, refunds, duplicates and inconsistent gaps", () => {
  assert.equal(detectRecurring([tx("2026-07-05")]).length, 0);
  assert.equal(
    detectRecurring([tx("2026-07-05"), tx("2026-07-05"), tx("2026-08-05")])
      .length,
    0,
  );
  assert.equal(
    detectRecurring([tx("2026-07-05"), tx("2026-08-05"), tx("2026-08-09")])
      .length,
    0,
  );
  assert.equal(
    detectRecurring([
      tx("2026-07-05", "x", -100),
      tx("2026-08-05", "x", -100),
      tx("2026-09-05", "x", -100),
    ]).length,
    0,
  );
});
test("handles weekly and annual renewals", () => {
  assert.equal(
    detectRecurring([tx("2026-07-01"), tx("2026-07-08"), tx("2026-07-15")])[0]
      .cadence,
    "weekly",
  );
  assert.equal(
    detectRecurring([tx("2024-07-01"), tx("2025-07-01"), tx("2026-07-01")])[0]
      .cadence,
    "yearly",
  );
});
test("rejects volatile spending at one merchant", () =>
  assert.equal(
    detectRecurring([
      tx("2026-07-05", "shop", 10000),
      tx("2026-08-05", "shop", 50000),
      tx("2026-09-05", "shop", 64900),
    ]).length,
    0,
  ));
test("clamps end-of-month estimates and leap years correctly", () => {
  const monthly = detectRecurring([
    tx("2026-11-30"),
    tx("2026-12-31"),
    tx("2027-01-31"),
  ]);
  assert.equal(monthly[0].nextDate, "2027-02-28");
  const yearly = detectRecurring([
    tx("2022-02-28"),
    tx("2023-02-28"),
    tx("2024-02-29"),
  ]);
  assert.equal(yearly[0].nextDate, "2025-02-28");
});
