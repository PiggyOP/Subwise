import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db.js";
import { ingestFinancialEvent } from "./connections.js";
import { demoProfiles, demoStatement } from "./demo-bank-data.js";

await db.exec(`CREATE TABLE IF NOT EXISTS demo_bank_runs(
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);`);
export function demoBankAllowed(user, env = process.env) {
  return (
    env.DEMO_BANK_ENABLED === "true" &&
    (env.DEMO_BANK_EMAILS || "")
      .split(",")
      .some((e) => e.trim().toLowerCase() === user.email.toLowerCase())
  );
}
async function accountState(userId) {
  const rows = await db
    .prepare(
      "SELECT c.id,c.status,d.payload FROM connections c JOIN demo_bank_runs d ON d.connection_id=c.id WHERE c.user_id=? AND c.channel='demo_bank' ORDER BY c.created",
    )
    .all(userId);
  return {
    synthetic: true,
    profiles: demoProfiles,
    accounts: await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        status: r.status,
        statement: JSON.parse(r.payload),
        subscriptions: await db
          .prepare(
            "SELECT name,amount,cadence,status,merchant_key,confidence FROM subscriptions WHERE user_id=? AND source='demo_bank' AND merchant_key LIKE ? ORDER BY name",
          )
          .all(userId, r.id + ":%"),
      })),
    ),
  };
}
export function registerDemoBankRoutes(app, { auth, paid }) {
  const allowed = (req, res, next) =>
    demoBankAllowed(req.user)
      ? next()
      : res
          .status(404)
          .json({ error: "Demo bank is not enabled for this account" });
  app.get("/api/demo-bank", auth, allowed, paid, async (req, res) =>
    res.json(await accountState(req.user.id)),
  );
  app.post("/api/demo-bank/connect", auth, allowed, paid, async (req, res) => {
    const { number } = z
      .object({
        number: z.enum(["9000000000", "9000000001"]),
        code: z.literal("123456"),
      })
      .strict()
      .parse(req.body);
    // Public test code selects a dataset; the existing account session and Plus gate authorize access.
    const id = createHash("sha256")
      .update(req.user.id + ":demo-bank-v1:" + number)
      .digest("hex");
    await db
      .prepare("INSERT OR IGNORE INTO connections VALUES(?,?,?,?,?,?)")
      .run(
        id,
        req.user.id,
        "demo_bank",
        "pending",
        null,
        new Date().toISOString(),
      );
    await db
      .prepare("INSERT OR IGNORE INTO demo_bank_runs VALUES(?,?)")
      .run(id, JSON.stringify(demoStatement(number)));
    const record = await db
      .prepare("SELECT payload FROM demo_bank_runs WHERE connection_id=?")
      .get(id);
    const data = JSON.parse(record.payload);
    const transactions = [
      ...new Map(data.transactions.map((t) => [t.id, t])).values(),
    ].map(({ id, merchant, amount, date, currency }) => ({
      id,
      merchant,
      amount,
      date,
      currency,
    }));
    await ingestFinancialEvent(
      {
        id: "demo-bank-v1:" + id,
        status: "connected",
        transactions,
        recurring: data.mandates.filter((m) => m.status === "active"),
      },
      { id, user_id: req.user.id, channel: "demo_bank" },
    );
    res.json(await accountState(req.user.id));
  });
}
