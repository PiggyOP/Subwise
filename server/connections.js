import {
  createHmac,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import express from "express";
import { z } from "zod";
import { db, audit } from "./db.js";
import { detectRecurring } from "./detection.js";
import { identify } from "./catalog.js";
import { reconcileCancellationStates } from "./cancellations.js";
const channels = z.enum(["card", "upi"]);
const rowSchema = z
  .object({
    id: z.string().min(1).max(200),
    merchant: z.string().min(1).max(200),
    amount: z.number().int().min(-100000000).max(100000000),
    date: z.iso.date(),
    currency: z.literal("INR"),
  })
  .strict();
const eventSchema = z
  .object({
    id: z.string().min(1).max(200),
    connectionId: z.uuid(),
    status: z.enum(["connected", "revoked", "error"]),
    transactions: z.array(rowSchema).max(10000).default([]),
    recurring: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            merchant: z.string().min(1).max(200),
            amount: z.number().int().positive().max(100000000),
            cadence: z.enum(["monthly", "yearly"]),
            nextDate: z.iso.date(),
            currency: z.literal("INR"),
            status: z.enum(["active", "cancelled"]),
          })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .strict();
export function connectorAvailable(channel) {
  return !!(
    process.env.FINANCIAL_CONNECTOR_URL &&
    process.env.FINANCIAL_CONNECTOR_SECRET &&
    process.env.FINANCIAL_WEBHOOK_SECRET &&
    (process.env.FINANCIAL_CONNECTOR_CHANNELS || "")
      .split(",")
      .map((x) => x.trim())
      .includes(channel)
  );
}
db.exec(`CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,channel TEXT NOT NULL,status TEXT NOT NULL,last_sync TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_transactions(connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,provider_id TEXT NOT NULL,merchant TEXT NOT NULL,amount INTEGER NOT NULL,date TEXT NOT NULL,currency TEXT NOT NULL,PRIMARY KEY(connection_id,provider_id));
CREATE TABLE IF NOT EXISTS financial_events(id TEXT PRIMARY KEY,created TEXT NOT NULL);`);
export function registerFinancialWebhook(app) {
  app.post(
    "/api/webhooks/financial",
    express.raw({ type: "application/json", limit: "2mb" }),
    (req, res) => {
      const secret = process.env.FINANCIAL_WEBHOOK_SECRET;
      if (!secret)
        return res
          .status(503)
          .json({ error: "Financial provider is not configured" });
      const timestamp = req.get("x-subwise-timestamp") || "",
        signature = req.get("x-subwise-signature") || "";
      if (
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      )
        return res.status(401).json({ error: "Expired financial event" });
      const expected = createHmac("sha256", secret)
        .update(timestamp + ".")
        .update(req.body)
        .digest("hex");
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
      )
        return res.status(401).json({ error: "Invalid signature" });
      const event = eventSchema.parse(JSON.parse(req.body.toString()));
      const connection = db
        .prepare("SELECT * FROM connections WHERE id=?")
        .get(event.connectionId);
      if (!connection)
        return res.status(404).json({ error: "Connection not found" });
      if (!connectorAvailable(connection.channel))
        return res.status(503).json({ error: "Channel is not enabled" });
      if (
        db.prepare("SELECT id FROM financial_events WHERE id=?").get(event.id)
      )
        return res.json({ ok: true, duplicate: true });
      if (connection.status === "revoked")
        return res.status(409).json({ error: "Connection is revoked" });
      if (
        event.status !== "connected" &&
        (event.transactions.length || event.recurring.length)
      )
        return res
          .status(400)
          .json({ error: "Transactions require active consent" });
      db.exec("BEGIN IMMEDIATE");
      try {
        let added = 0;
        for (const t of event.transactions)
          added += Number(
            db
              .prepare(
                "INSERT OR IGNORE INTO provider_transactions VALUES(?,?,?,?,?,?)",
              )
              .run(
                connection.id,
                t.id,
                t.merchant,
                t.amount,
                t.date,
                t.currency,
              ).changes,
          );
        db.prepare(
          "UPDATE connections SET status=?,last_sync=? WHERE id=?",
        ).run(event.status, new Date().toISOString(), connection.id);
        if (event.status === "connected") {
          const all = db
            .prepare(
              "SELECT merchant,amount,date FROM provider_transactions WHERE connection_id=?",
            )
            .all(connection.id);
          for (const found of detectRecurring(all).filter(
            (r) =>
              ["monthly", "yearly"].includes(r.cadence) &&
              !event.recurring.some(
                (stream) =>
                  (identify(stream.merchant)?.id ||
                    stream.merchant.toLowerCase()) ===
                  (identify(r.name)?.id || r.name.toLowerCase()),
              ),
          )) {
            const key = connection.id + ":" + found.merchantKey;
            const existing = db
              .prepare(
                "SELECT * FROM subscriptions WHERE user_id=? AND merchant_key=?",
              )
              .get(connection.user_id, key);
            const age = (Date.now() - Date.parse(found.nextDate)) / 86400000;
            const status =
              age > (found.cadence === "monthly" ? 45 : 180)
                ? "needs_review"
                : "active";
            if (existing) {
              if (existing.status !== "cancelled")
                db.prepare(
                  "UPDATE subscriptions SET amount=?,cadence=?,next_date=?,confidence=? WHERE id=?",
                ).run(
                  found.amount,
                  found.cadence,
                  found.nextDate,
                  found.confidence,
                  existing.id,
                );
            } else
              db.prepare(
                "INSERT INTO subscriptions(id,user_id,name,amount,cadence,next_date,category,payment,status,source,merchant_key,confidence,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
              ).run(
                randomUUID(),
                connection.user_id,
                found.name,
                found.amount,
                found.cadence,
                found.nextDate,
                found.category,
                connection.channel === "card" ? "Card" : "UPI",
                status,
                connection.channel,
                key,
                found.confidence,
                new Date().toISOString(),
              );
          }
        }
        for (const stream of event.recurring) {
          const service = identify(stream.merchant);
          const streamKey = connection.id + ":stream:" + stream.id;
          const inferredKey =
            connection.id +
            ":" +
            (service?.id ||
              stream.merchant.toLowerCase().replace(/[^a-z]/g, ""));
          // Preserve subscription identity and its cancellation authorization when an inferred stream becomes authoritative.
          db.prepare(
            "UPDATE subscriptions SET merchant_key=? WHERE user_id=? AND merchant_key=? AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id=? AND merchant_key=?)",
          ).run(
            streamKey,
            connection.user_id,
            inferredKey,
            connection.user_id,
            streamKey,
          );
          db.prepare(
            "DELETE FROM subscriptions WHERE user_id=? AND merchant_key=? AND NOT EXISTS (SELECT 1 FROM cancellation_jobs WHERE cancellation_jobs.subscription_id=subscriptions.id)",
          ).run(connection.user_id, inferredKey);
          db.prepare(
            "INSERT INTO subscriptions(id,user_id,name,amount,cadence,next_date,category,payment,status,source,merchant_key,confidence,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,merchant_key) WHERE merchant_key IS NOT NULL DO UPDATE SET name=excluded.name,amount=excluded.amount,cadence=excluded.cadence,next_date=excluded.next_date,status=excluded.status,confidence=excluded.confidence",
          ).run(
            randomUUID(),
            connection.user_id,
            service?.name || stream.merchant,
            stream.amount,
            stream.cadence,
            stream.nextDate,
            service?.category || "Other",
            connection.channel === "card" ? "Card" : "UPI",
            stream.status,
            connection.channel,
            streamKey,
            1,
            new Date().toISOString(),
          );
        }
        db.prepare("INSERT INTO financial_events VALUES(?,?)").run(
          event.id,
          new Date().toISOString(),
        );
        audit(
          connection.user_id,
          "connection." + event.status,
          `${connection.channel}: ${added} new transactions`,
        );
        reconcileCancellationStates();
        db.exec("COMMIT");
        res.json({ ok: true, added });
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  );
}
export function registerConnectionRoutes(app, { auth, paid, origin }) {
  app.get("/api/connections", auth, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,channel,status,last_sync,created FROM connections WHERE user_id=? ORDER BY created DESC",
        )
        .all(req.user.id),
    ),
  );
  app.post("/api/connections", auth, paid, async (req, res) => {
    const { channel } = z
      .object({ channel: channels })
      .strict()
      .parse(req.body);
    if (!connectorAvailable(channel))
      return res.status(503).json({
        error: `${channel === "card" ? "Card transaction" : "UPI"} connection is not available yet. An approved provider must be configured before automatic tracking can start.`,
      });
    const base = new URL(process.env.FINANCIAL_CONNECTOR_URL);
    if (base.protocol !== "https:")
      return res
        .status(503)
        .json({ error: "The financial connector requires HTTPS" });
    const id = randomUUID();
    db.prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)").run(
      id,
      req.user.id,
      channel,
      "pending",
      null,
      new Date().toISOString(),
    );
    try {
      const result = await fetch(new URL("/sessions", base), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.FINANCIAL_CONNECTOR_SECRET,
          "Content-Type": "application/json",
          "Idempotency-Key": id,
        },
        body: JSON.stringify({
          connectionId: id,
          subject: createHash("sha256").update(req.user.id).digest("hex"),
          channel,
          returnUrl: origin + "/?connection_return=1",
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!result.ok) throw Error("Provider session failed");
      const output = await result.json(),
        url = new URL(output.authorizationUrl);
      const allowed = (process.env.FINANCIAL_AUTH_ORIGINS || base.origin)
        .split(",")
        .map((x) => x.trim());
      if (url.protocol !== "https:" || !allowed.includes(url.origin))
        throw Error("Provider returned an unapproved authorization origin");
      audit(req.user.id, "connection.started", channel);
      res.status(201).json({ id, authorizationUrl: url.href });
    } catch {
      db.prepare("UPDATE connections SET status='error' WHERE id=?").run(id);
      res.status(502).json({
        error:
          "The connection provider is unavailable. Please try again later.",
      });
    }
  });
}
