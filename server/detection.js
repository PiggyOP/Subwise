import { identify } from "./catalog.js";
export function detectRecurring(transactions) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const known = identify(t.merchant);
    const key =
      known?.id ||
      t.merchant
        .toLowerCase()
        .replace(/\b(upi|pos|debit|payment)\b/g, "")
        .replace(/\d+/g, "")
        .replace(/[^a-z]/g, "")
        .trim();
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(t);
    groups.set(key, list);
  }
  const results = [];
  for (const [key, raw] of groups) {
    const list = [...new Map(raw.map((x) => [x.date, x])).values()].sort(
      (a, b) => a.date.localeCompare(b.date),
    );
    if (list.length < 3) continue;
    const gaps = list
      .slice(1)
      .map(
        (t, i) => (Date.parse(t.date) - Date.parse(list[i].date)) / 86400000,
      );
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const cadence =
      median >= 25 && median <= 35
        ? "monthly"
        : median >= 6 && median <= 8
          ? "weekly"
          : median >= 350 && median <= 380
            ? "yearly"
            : null;
    if (!cadence) continue;
    const expected =
      cadence === "monthly" ? 30.44 : cadence === "weekly" ? 7 : 365.25;
    if (gaps.some((g) => Math.abs(g - expected) > expected * 0.2)) continue;
    const mean = list.reduce((s, t) => s + t.amount, 0) / list.length;
    if (list.some((t) => Math.abs(t.amount - mean) > mean * 0.2)) continue;
    const last = list.at(-1),
      known = identify(last.merchant);
    const next = new Date(last.date + "T12:00:00Z");
    if (cadence === "monthly") {
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(
        Math.min(
          day,
          new Date(
            Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        ),
      );
    } else if (cadence === "yearly") {
      const month = next.getUTCMonth();
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      if (next.getUTCMonth() !== month) next.setUTCDate(0);
    } else next.setUTCDate(next.getUTCDate() + 7);
    results.push({
      name: known?.name || last.merchant,
      merchantKey: key,
      amount: last.amount,
      cadence,
      nextDate: next.toISOString().slice(0, 10),
      category: known?.category || "Other",
      confidence: Math.min(0.98, 0.72 + list.length * 0.04),
      evidenceCount: list.length,
    });
  }
  return results;
}
