import express from "express";
import { z } from "zod";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { db, audit, withDatabaseContext } from "./db.js";
import { ingestFinancialEvent } from "./connections.js";
import {
  setuConfigured,
  setuAllowed,
  consentRequest,
  consentURL,
  makeSetuClient,
  normalizeSetuTransactions,
  SetuError,
} from "./setu-client.js";
export { setuAllowed } from "./setu-client.js";
const client = makeSetuClient();
await db.exec(`CREATE TABLE IF NOT EXISTS setu_connections(
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  consent_id TEXT UNIQUE NOT NULL, authorization_url TEXT NOT NULL,
  session_id TEXT, range_from TEXT NOT NULL, range_to TEXT NOT NULL,
  consent_expires TEXT NOT NULL, purge_after TEXT NOT NULL,
  next_sync INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
  session_attempted INTEGER NOT NULL DEFAULT 0, last_error TEXT
);`);
if (
  !(await db.prepare("PRAGMA table_info(setu_connections)").all()).some(
    (c) => c.name === "customer_key",
  )
)
  await db.exec("ALTER TABLE setu_connections ADD COLUMN customer_key TEXT");

function publicError(e) {
  if (e instanceof SetuError && e.code === "DataSessionFAILED")
    return "The mock bank could not share this account’s data. Start a new test connection and select a normal sample account, not one labelled FAILURE.";
  if (
    e instanceof SetuError &&
    e.status === 403 &&
    e.code === "NonJSONResponse"
  )
    return "Setu is rejecting the connection from this website’s server. No bank data was connected. Setu needs to confirm sandbox access for this hosting server.";
  return e instanceof SetuError
    ? `Setu sandbox could not complete the request (HTTP ${e.status}, ${e.code}${e.endpoint ? "; " + e.endpoint : ""}${e.traceId ? "; reference " + e.traceId : ""}). Please retry later.`
    : "Setu sandbox is temporarily unavailable. Please retry later.";
}
function opaqueId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id))
    throw new SetuError(502, "InvalidProviderID");
  return id;
}
async function retire(row, status) {
  await db
    .prepare("UPDATE connections SET status=? WHERE id=?")
    .run(status, row.connection_id);
  await db
    .prepare(
      "UPDATE subscriptions SET status='needs_review' WHERE user_id=? AND source='setu_sandbox' AND merchant_key LIKE ? AND status!='cancelled'",
    )
    .run(row.user_id, row.connection_id + ":%");
}
export async function syncSetuConnection(row, { api = client } = {}) {
  if (!setuConfigured()) return;
  const now = Date.now();
  const acquired = await db
    .prepare(
      "UPDATE setu_connections SET lease_until=?,next_sync=? WHERE connection_id=? AND lease_until<? AND next_sync<=?",
    )
    .run(now + 45000, now + 60000, row.connection_id, now, now);
  if (!acquired.changes) return;
  try {
    if (Date.parse(row.purge_after) <= now) {
      await db.exec("BEGIN IMMEDIATE");
      try {
        await retire(row, "expired");
        await db
          .prepare("DELETE FROM provider_transactions WHERE connection_id=?")
          .run(row.connection_id);
        await db
          .prepare(
            "DELETE FROM subscriptions WHERE user_id=? AND source='setu_sandbox' AND merchant_key LIKE ?",
          )
          .run(row.user_id, row.connection_id + ":%");
        await db
          .prepare("DELETE FROM setu_connections WHERE connection_id=?")
          .run(row.connection_id);
        await db.exec("COMMIT");
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
      return;
    }
    const consent = await api.request(
      "/v2/consents/" + opaqueId(row.consent_id),
    );
    if (consent.id !== row.consent_id)
      throw new SetuError(502, "ConsentMismatch");
    if (consent.status !== "ACTIVE") {
      const status = [
        "REJECTED",
        "REVOKED",
        "EXPIRED",
        "PAUSED",
        "FAILED",
      ].includes(consent.status)
        ? consent.status.toLowerCase()
        : "pending";
      if (status !== "pending") await retire(row, status);
      return;
    }
    if (Date.parse(row.consent_expires) <= now) {
      await retire(row, "expired");
      return;
    }
    await db
      .prepare(
        "UPDATE connections SET status='connected' WHERE id=? AND status!='revoked'",
      )
      .run(row.connection_id);
    let sessionId = row.session_id;
    if (!sessionId) {
      // Recover provider auto-fetch or an ambiguous POST before ever making another session.
      const sessions = await api.request(
        "/v2/consents/" + opaqueId(row.consent_id) + "/data-sessions",
      );
      if (
        sessions.consentId !== row.consent_id ||
        !Array.isArray(sessions.dataSessions)
      )
        throw new SetuError(502, "SessionListMismatch");
      sessionId = sessions.dataSessions.find(
        (s) => !["FAILED", "EXPIRED"].includes(s.status),
      )?.sessionId;
      if (!sessionId && row.session_attempted)
        throw new SetuError(502, "SessionAwaitingReconciliation");
      if (!sessionId) {
        await db
          .prepare(
            "UPDATE setu_connections SET session_attempted=1 WHERE connection_id=?",
          )
          .run(row.connection_id);
        const session = await api.request("/v2/sessions", {
          consentId: row.consent_id,
          dataRange: { from: row.range_from, to: row.range_to },
          format: "json",
        });
        if (session.consentId !== row.consent_id)
          throw new SetuError(502, "SessionMismatch");
        sessionId = session.id;
      }
      opaqueId(sessionId);
      await db
        .prepare(
          "UPDATE setu_connections SET session_id=? WHERE connection_id=?",
        )
        .run(sessionId, row.connection_id);
    }
    const session = await api.request("/v2/sessions/" + opaqueId(sessionId));
    if (session.id !== sessionId || session.consentId !== row.consent_id)
      throw new SetuError(502, "SessionMismatch");
    if (["FAILED", "EXPIRED"].includes(session.status)) {
      // A terminal data session cannot recover through polling. Let the tester
      // start a new consent instead of leaving a failed fixture connected forever.
      await retire(row, "failed");
      throw new SetuError(502, "DataSession" + session.status);
    }
    if (!["PARTIAL", "COMPLETED"].includes(session.status)) return;
    const transactions = normalizeSetuTransactions(session).filter(
      (t) =>
        t.date >= row.range_from.slice(0, 10) &&
        t.date <= row.range_to.slice(0, 10),
    );
    const digest = createHash("sha256")
      .update(JSON.stringify(transactions))
      .digest("hex");
    const eventId = "setu:" + sessionId + ":" + digest;
    if (
      !(await db
        .prepare("SELECT id FROM financial_events WHERE id=?")
        .get(eventId))
    ) {
      const connection = await db
        .prepare("SELECT * FROM connections WHERE id=?")
        .get(row.connection_id);
      if (connection.status === "revoked") return;
      await ingestFinancialEvent(
        { id: eventId, status: "connected", transactions, recurring: [] },
        connection,
      );
    }
    await db
      .prepare(
        "UPDATE setu_connections SET last_error=NULL,next_sync=? WHERE connection_id=?",
      )
      .run(
        now + (session.status === "COMPLETED" ? 3600000 : 60000),
        row.connection_id,
      );
  } catch (e) {
    await db
      .prepare("UPDATE setu_connections SET last_error=? WHERE connection_id=?")
      .run(publicError(e), row.connection_id);
  } finally {
    await db
      .prepare(
        "UPDATE setu_connections SET lease_until=0 WHERE connection_id=?",
      )
      .run(row.connection_id);
  }
}
export async function runSetuSync({
  userId,
  batchSize = 1,
  api = client,
} = {}) {
  if (!setuConfigured()) return;
  const rows = await db
    .prepare(
      `SELECT s.*,c.user_id,c.status FROM setu_connections s JOIN connections c ON c.id=s.connection_id
    WHERE s.next_sync<=? AND s.lease_until<? AND (c.status NOT IN ('revoked','rejected','expired','failed') OR s.purge_after<=?)${userId ? " AND c.user_id=?" : ""} ORDER BY s.next_sync LIMIT ?`,
    )
    .all(
      Date.now(),
      Date.now(),
      new Date().toISOString(),
      ...(userId ? [userId] : []),
      batchSize,
    );
  for (const row of rows) await syncSetuConnection(row, { api });
}
export function registerSetuWebhook(app) {
  app.post(
    "/api/webhooks/setu/:token",
    express.json({ limit: "32kb" }),
    async (req, res) => {
      const secret = process.env.SETU_WEBHOOK_TOKEN || "";
      const provided = req.params.token || "";
      if (
        !setuConfigured() ||
        secret.length < 32 ||
        provided.length !== secret.length ||
        !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))
      )
        return res.status(404).json({ error: "Endpoint not found" });
      // Setu's public docs don't specify a signature. Treat ALL callback fields as untrusted hints.
      // Only authenticated server-to-server GETs above may change consent status or ingest data.
      if (
        [
          "CONSENT_STATUS_UPDATE",
          "SESSION_STATUS_UPDATE",
          "FI_DATA_READY",
        ].includes(req.body?.type) &&
        typeof req.body.consentId === "string"
      )
        await db
          .prepare(
            "UPDATE setu_connections SET next_sync=0 WHERE consent_id=? AND next_sync>?",
          )
          .run(req.body.consentId, Date.now());
      res.status(202).json({ received: true });
    },
  );
}
export function registerSetuRoutes(app, { auth, paid, origin }) {
  const allowed = (req, res, next) =>
    setuAllowed(req.user)
      ? next()
      : res
          .status(404)
          .json({ error: "Sandbox access is not enabled for this account" });
  app.get("/api/setu/connections", auth, allowed, async (req, res) => {
    res.json(
      await db
        .prepare(
          "SELECT c.id,c.status,c.last_sync,s.last_error,s.authorization_url FROM connections c JOIN setu_connections s ON s.connection_id=c.id WHERE c.user_id=? ORDER BY c.created DESC",
        )
        .all(req.user.id),
    );
  });
  app.post("/api/setu/connections", auth, paid, allowed, async (req, res) => {
    const { mobile } = z
      .object({
        mobile: z
          .string()
          .regex(
            /^[6-9]\d{9}$/,
            "Enter a valid 10-digit sandbox-registered mobile number",
          ),
      })
      .strict()
      .parse(req.body);
    const request = consentRequest(origin, new Date(), mobile);
    const customerKey = createHash("sha256")
      .update(process.env.SETU_WEBHOOK_TOKEN + ":" + request.vua)
      .digest("hex");
    const pending = await db
      .prepare(
        "SELECT s.* FROM setu_connections s JOIN connections c ON c.id=s.connection_id WHERE c.user_id=? AND c.status='pending' AND s.consent_expires>? AND s.customer_key=? ORDER BY c.created DESC LIMIT 1",
      )
      .get(req.user.id, new Date().toISOString(), customerKey);
    if (pending)
      return res.json({
        id: pending.connection_id,
        authorizationUrl: consentURL(pending.authorization_url),
        sandbox: true,
      });
    const existing = await db
      .prepare(
        "SELECT c.id FROM connections c JOIN setu_connections s ON s.connection_id=c.id WHERE c.user_id=? AND c.status='connected'",
      )
      .get(req.user.id);
    if (existing)
      return res.status(409).json({
        error: "A sandbox bank is already connected. Use Refresh sandbox data.",
      });
    try {
      const consent = await client.request("/v2/consents", request);
      const id = randomUUID(),
        consentId = opaqueId(consent.id),
        url = consentURL(consent.url);
      const expires = consent.detail?.consentExpiry;
      if (!Number.isFinite(Date.parse(expires)))
        throw new SetuError(502, "InvalidConsentExpiry");
      await db.exec("BEGIN IMMEDIATE");
      try {
        await db
          .prepare(
            "UPDATE connections SET status='failed' WHERE user_id=? AND channel='bank' AND status='pending'",
          )
          .run(req.user.id);
        await db
          .prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)")
          .run(
            id,
            req.user.id,
            "bank",
            "pending",
            null,
            new Date().toISOString(),
          );
        // Conservatively remove sandbox financial records after 28 days, before the one-month data-life limit.
        await db
          .prepare(
            "INSERT INTO setu_connections(connection_id,consent_id,authorization_url,range_from,range_to,consent_expires,purge_after,customer_key) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            consentId,
            url,
            request.dataRange.from,
            request.dataRange.to,
            expires,
            new Date(Date.now() + 28 * 86400000).toISOString(),
            customerKey,
          );
        await audit(
          req.user.id,
          "setu.sandbox.started",
          "Setu test bank consent",
        );
        await db.exec("COMMIT");
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
      res.status(201).json({ id, authorizationUrl: url, sandbox: true });
    } catch (e) {
      res.status(502).json({ error: publicError(e) });
    }
  });
  app.post("/api/setu/sync", auth, paid, allowed, async (req, res) => {
    await runSetuSync({ userId: req.user.id });
    res.json({ ok: true, sandbox: true });
  });
}
export function startSetuWorker() {
  if (!setuConfigured()) return () => {};
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await withDatabaseContext(() => runSetuSync());
    } catch {
      console.error("Setu sandbox sync failed");
    } finally {
      busy = false;
    }
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
