// Entirely synthetic. These public demo identities never contact an AA or send SMS.
export const demoProfiles = [
  { number: "9000000000", name: "Mixed payments & subscriptions" },
  { number: "9000000001", name: "Everyday payments only" },
];
export function demoStatement(number, now = new Date()) {
  const endMonth = now.getUTCMonth() - (now.getUTCDate() < 20 ? 1 : 0);
  const date = (offset, day) =>
    new Date(Date.UTC(now.getUTCFullYear(), endMonth + offset, day))
      .toISOString()
      .slice(0, 10);
  const transactions = [];
  const add = (id, merchant, amount, day, offset = 0, method = "UPI") =>
    transactions.push({
      id,
      merchant,
      amount,
      date: date(offset, day),
      currency: "INR",
      direction: amount > 0 ? "DEBIT" : "CREDIT",
      method,
    });
  for (const [i, offset] of [-2, -1, 0].entries()) {
    add(`salary-${i}`, "SALARY / DEMO EMPLOYER", -8500000, 1, offset, "NEFT");
    add(
      `groceries-${i}`,
      "FRESH MART",
      [183400, 297500, 142000][i],
      [3, 11, 16][i],
      offset,
    );
    add(
      `ride-${i}`,
      "UPI/UBER/FARE",
      [27600, 59900, 18400][i],
      [9, 24, 7][i],
      offset,
    );
    add(
      `shop-${i}`,
      "AMAZON / SHOPPING",
      [159900, 48900, 325000][i],
      [14, 4, 19][i],
      offset,
      "Debit card",
    );
    add(
      `food-${i}`,
      "ZOMATO / ORDER",
      [48500, 111000, 32900][i],
      [21, 8, 15][i],
      offset,
    );
    if (number === "9000000000") {
      add(
        `netflix-${i}`,
        "UPI/NETFLIX/RENEWAL",
        64900,
        5,
        offset,
        "UPI Autopay",
      );
      add(`spotify-${i}`, "SPOTIFY PREMIUM", 11900, 12, offset, "Debit card");
      add(
        `gym-${i}`,
        "NACH/HARBOR FITNESS",
        150000,
        18,
        offset,
        "NACH Autopay",
      );
      add(`cloud-${i}`, "APPLE ICLOUD", 7500, 20, offset, "Debit card");
    }
  }
  add("dinner", "THE CORNER CAFE", 146000, 17);
  add("transfer", "UPI / DEMO FRIEND", 200000, 10);
  add("refund", "AMAZON / REFUND", -48900, 13);
  add("reimbursement", "UPI / REIMBURSEMENT", -200000, 11);
  const mandates = [];
  if (number === "9000000000") {
    // A repeated delivery of the same provider transaction must not add evidence.
    transactions.push({ ...transactions.find((t) => t.id === "netflix-2") });
    add("annual", "MICROSOFT 365", 689900, 2, 0, "Card Autopay");
    const next = new Date(date(0, 2) + "T12:00:00Z");
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    mandates.push({
      id: "demo-m365-annual",
      merchant: "MICROSOFT 365",
      amount: 689900,
      cadence: "yearly",
      nextDate: next.toISOString().slice(0, 10),
      currency: "INR",
      status: "active",
    });
    mandates.push({
      id: "demo-old-plan",
      merchant: "Old magazine plan",
      amount: 9900,
      cadence: "monthly",
      nextDate: date(1, 10),
      currency: "INR",
      status: "cancelled",
    });
  }
  return {
    synthetic: true,
    version: 1,
    name: demoProfiles.find((p) => p.number === number)?.name,
    account: number.endsWith("0") ? "DEMO •••• 0000" : "DEMO •••• 0001",
    generatedAt: now.toISOString(),
    transactions,
    mandates,
  };
}
