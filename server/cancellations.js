import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, audit } from "./db.js";

// These are cancellation permissions, independent of read-only financial consent.
db.exec(`
CREATE TABLE IF NOT EXISTS cancellation_capabilities(
 subscription_id TEXT PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
 provider_ref TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, version INTEGER NOT NULL,
 expires TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cancellation_jobs(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL UNIQUE, provider_ref TEXT NOT NULL, capability_version INTEGER NOT NULL,
 status TEXT NOT NULL, consent_at TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, lease_until INTEGER,
 provider_sequence INTEGER NOT NULL DEFAULT 0, receipt TEXT, effective_at TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS cancellation_events(id TEXT PRIMARY KEY, created TEXT NOT NULL);
`);
if (
  !db
    .prepare("PRAGMA table_info(cancellation_jobs)")
    .all()
    .some((col) => col.name === "prior_status")
)
  db.exec(
    "ALTER TABLE cancellation_jobs ADD COLUMN prior_status TEXT NOT NULL DEFAULT 'active'",
  );
db.exec(
  "CREATE INDEX IF NOT EXISTS cancellation_due ON cancellation_jobs(status,next_attempt,lease_until); CREATE INDEX IF NOT EXISTS cancellation_owner ON cancellation_jobs(user_id,status)",
);
export function cancellationConfigured() {
  try {
    const u = new URL(process.env.CANCELLATION_CONNECTOR_URL);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash &&
      !!process.env.CANCELLATION_CONNECTOR_SECRET &&
      !!process.env.CANCELLATION_WEBHOOK_SECRET
    );
  } catch {
    return false;
  }
}
function publicJob(job) {
  return job
    ? {
        id: job.id,
        status: job.status,
        requestedAt: job.consent_at,
        updatedAt: job.updated,
        confirmation: job.receipt,
        effectiveAt: job.effective_at,
        error: job.error,
      }
    : null;
}
export function cancellationDetails(subscriptionId, now = new Date()) {
  const capability = db
    .prepare("SELECT * FROM cancellation_capabilities WHERE subscription_id=?")
    .get(subscriptionId);
  const job = db
    .prepare("SELECT * FROM cancellation_jobs WHERE subscription_id=?")
    .get(subscriptionId);
  return {
    available:
      cancellationConfigured() &&
      !!capability?.enabled &&
      Date.parse(capability.expires) > now.getTime(),
    version: capability?.version || null,
    job: publicJob(job),
  };
}
export function cancellationInProgress(userId, subscriptionId) {
  return !!db
    .prepare(
      "SELECT id FROM cancellation_jobs WHERE user_id=? AND status IN ('queued','processing','submitted','unknown','scheduled')" +
        (subscriptionId ? " AND subscription_id=?" : ""),
    )
    .get(...(subscriptionId ? [userId, subscriptionId] : [userId]));
}
const resultSchema = z
  .object({
    jobId: z.uuid(),
    providerRef: z.string().min(1).max(250),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(["submitted", "scheduled", "cancelled", "failed"]),
    reference: z.string().min(1).max(250).optional(),
    effectiveAt: z.iso.datetime().optional(),
    renewalStopped: z.boolean().optional(),
  })
  .strict();
export function applyCancellationResult(input, now = new Date()) {
  const result = resultSchema.parse(input);
  const job = db
    .prepare("SELECT * FROM cancellation_jobs WHERE id=?")
    .get(result.jobId);
  if (!job || job.provider_ref !== result.providerRef)
    throw Error("Cancellation reference mismatch");
  if (
    result.sequence <= job.provider_sequence ||
    job.status === "cancelled" ||
    job.status === "failed"
  )
    return false;
  if (job.status === "queued")
    throw Error("Cancellation has not been dispatched");
  if (
    job.status === "scheduled" &&
    ["submitted", "failed"].includes(result.status)
  )
    return false;
  let status = result.status;
  if (["scheduled", "cancelled"].includes(status)) {
    if (
      !result.reference ||
      !result.effectiveAt ||
      result.renewalStopped !== true
    )
      throw Error("Cancellation confirmation is incomplete");
    status =
      Date.parse(result.effectiveAt) > now.getTime()
        ? "scheduled"
        : "cancelled";
  }
  db.prepare(
    "UPDATE cancellation_jobs SET status=?,provider_sequence=?,receipt=?,effective_at=?,error=?,updated=?,lease_until=NULL,next_attempt=? WHERE id=?",
  ).run(
    status,
    result.sequence,
    result.reference || job.receipt,
    result.effectiveAt
      ? new Date(result.effectiveAt).toISOString()
      : job.effective_at,
    status === "failed"
      ? "The provider could not complete cancellation. Your subscription has not been marked cancelled."
      : null,
    now.toISOString(),
    now.getTime() + 60000,
    job.id,
  );
  if (status === "cancelled")
    db.prepare(
      "UPDATE subscriptions SET status='cancelled' WHERE id=? AND user_id=?",
    ).run(job.subscription_id, job.user_id);
  if (status === "failed")
    db.prepare(
      "UPDATE subscriptions SET status=? WHERE id=? AND user_id=? AND status='cancellation_requested'",
    ).run(job.prior_status, job.subscription_id, job.user_id);
  audit(job.user_id, "cancellation." + status, job.subscription_id);
  return true;
}
const capabilitySchema = z
  .object({
    id: z.string().min(1).max(250),
    type: z.literal("capability"),
    subscriptionId: z.uuid(),
    providerRef: z.string().min(1).max(250),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    scope: z.literal("subscription"),
    enabled: z.boolean(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const eventSchema = z.union([
  capabilitySchema,
  z
    .object({
      id: z.string().min(1).max(250),
      type: z.literal("result"),
      result: resultSchema,
    })
    .strict(),
]);
export function registerCancellationWebhook(app) {
  app.post(
    "/api/webhooks/cancellations",
    express.raw({ type: "application/json", limit: "64kb" }),
    (req, res) => {
      if (!cancellationConfigured())
        return res
          .status(503)
          .json({ error: "Cancellation provider is not configured." });
      const timestamp = req.get("x-subwise-timestamp") || "",
        signature = req.get("x-subwise-signature") || "";
      if (
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !Buffer.isBuffer(req.body)
      )
        return res.status(401).json({ error: "Invalid cancellation event." });
      const expected = createHmac(
        "sha256",
        process.env.CANCELLATION_WEBHOOK_SECRET,
      )
        .update(timestamp + ".")
        .update(req.body)
        .digest("hex");
      if (
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
      )
        return res
          .status(401)
          .json({ error: "Invalid cancellation signature." });
      const event = eventSchema.parse(JSON.parse(req.body.toString()));
      if (
        db
          .prepare("SELECT id FROM cancellation_events WHERE id=?")
          .get(event.id)
      )
        return res.json({ ok: true, duplicate: true });
      db.exec("BEGIN IMMEDIATE");
      try {
        if (event.type === "capability") {
          const sub = db
            .prepare(
              "SELECT * FROM subscriptions WHERE id=? AND source IN ('card','upi')",
            )
            .get(event.subscriptionId);
          if (!sub) {
            db.exec("ROLLBACK");
            return res.status(404).json({ error: "Subscription not found." });
          }
          const old = db
            .prepare(
              "SELECT * FROM cancellation_capabilities WHERE subscription_id=?",
            )
            .get(sub.id);
          if (!old || event.version > old.version) {
            if (
              old &&
              old.provider_ref !== event.providerRef &&
              cancellationInProgress(sub.user_id, sub.id)
            )
              throw Error("Cannot replace a reference during cancellation");
            db.prepare(
              "INSERT INTO cancellation_capabilities VALUES(?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET provider_ref=excluded.provider_ref,enabled=excluded.enabled,version=excluded.version,expires=excluded.expires,updated=excluded.updated",
            ).run(
              sub.id,
              event.providerRef,
              Number(event.enabled),
              event.version,
              event.expiresAt,
              new Date().toISOString(),
            );
            audit(
              sub.user_id,
              event.enabled
                ? "cancellation.permission_granted"
                : "cancellation.permission_revoked",
              sub.id,
            );
          }
        } else applyCancellationResult(event.result);
        db.prepare("INSERT INTO cancellation_events VALUES(?,?)").run(
          event.id,
          new Date().toISOString(),
        );
        db.exec("COMMIT");
        res.json({ ok: true });
      } catch (e) {
        db.exec("ROLLBACK");
        if (e instanceof z.ZodError) throw e;
        res
          .status(409)
          .json({ error: "Cancellation event could not be applied." });
      }
    },
  );
}
export function registerCancellationRoutes(
  app,
  { auth, paid, dispatch = runCancellationWorker },
) {
  app.post(
    "/api/subscriptions/:id/cancel",
    auth,
    paid,
    rateLimit({
      windowMs: 60000,
      limit: 12,
      keyGenerator: (req) => req.user.id,
    }),
    (req, res) => {
      const input = z
        .object({
          confirm: z.literal(true),
          capabilityVersion: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      const sub = db
        .prepare(
          "SELECT * FROM subscriptions WHERE id=? AND user_id=? AND source IN ('card','upi')",
        )
        .get(req.params.id, req.user.id);
      if (!sub)
        return res.status(404).json({ error: "Subscription not found." });
      const existing = db
        .prepare("SELECT * FROM cancellation_jobs WHERE subscription_id=?")
        .get(sub.id);
      if (existing) return res.json({ job: publicJob(existing) });
      if (!["active", "needs_review"].includes(sub.status))
        return res.status(409).json({
          error: "This subscription cannot be cancelled in its current state.",
        });
      const details = cancellationDetails(sub.id),
        capability = db
          .prepare(
            "SELECT * FROM cancellation_capabilities WHERE subscription_id=?",
          )
          .get(sub.id);
      if (!details.available)
        return res.status(409).json({
          error:
            "Automatic cancellation is not supported for this subscription. A merchant-authorized cancellation integration is required.",
        });
      if (input.capabilityVersion !== capability.version)
        return res.status(409).json({
          error:
            "Cancellation permission changed. Refresh and review it again.",
        });
      const id = randomUUID(),
        now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO cancellation_jobs(id,user_id,subscription_id,provider_ref,capability_version,prior_status,status,consent_at,created,updated,next_attempt) VALUES(?,?,?,?,?,?,'queued',?,?,?,?)",
        ).run(
          id,
          req.user.id,
          sub.id,
          capability.provider_ref,
          capability.version,
          sub.status,
          now,
          now,
          now,
          Date.now(),
        );
        db.prepare(
          "UPDATE subscriptions SET status='cancellation_requested' WHERE id=? AND user_id=?",
        ).run(sub.id, req.user.id);
        audit(req.user.id, "cancellation.authorized", sub.id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      res.status(202).json({
        job: publicJob(
          db.prepare("SELECT * FROM cancellation_jobs WHERE id=?").get(id),
        ),
      });
      void dispatch().catch(() => {});
    },
  );
}
async function providerRequest(job, method) {
  const base = new URL(process.env.CANCELLATION_CONNECTOR_URL);
  const response = await fetch(
    new URL(
      method === "POST"
        ? "/cancellations"
        : "/cancellations/" + encodeURIComponent(job.id),
      base,
    ),
    {
      method,
      redirect: "error",
      headers: {
        Authorization: "Bearer " + process.env.CANCELLATION_CONNECTOR_SECRET,
        "Content-Type": "application/json",
        "Idempotency-Key": "subwise/cancel/" + job.id,
      },
      ...(method === "POST"
        ? {
            body: JSON.stringify({
              jobId: job.id,
              providerRef: job.provider_ref,
              subscriptionId: job.subscription_id,
              capabilityVersion: job.capability_version,
              action: "cancel_subscription",
              timing: "period_end",
              authorizedAt: job.consent_at,
            }),
          }
        : {}),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw Error("Cancellation provider unavailable");
  return response.json();
}
let running = false;
export async function runCancellationWorker({
  now = new Date(),
  request = providerRequest,
} = {}) {
  if (running || !cancellationConfigured()) return;
  running = true;
  try {
    const started = Date.now();
    reconcileCancellationStates();
    const stamp = now.toISOString(),
      ms = now.getTime();
    // A lost response is ambiguous. Recover through read-only reconciliation, never a blind second cancellation.
    db.prepare(
      "UPDATE cancellation_jobs SET status='unknown',lease_until=NULL,next_attempt=? WHERE status='processing' AND lease_until<?",
    ).run(ms, ms);
    for (const job of db
      .prepare(
        "SELECT * FROM cancellation_jobs WHERE status='scheduled' AND effective_at<=?",
      )
      .all(stamp)) {
      db.prepare(
        "UPDATE cancellation_jobs SET status='cancelled',updated=? WHERE id=?",
      ).run(stamp, job.id);
      db.prepare(
        "UPDATE subscriptions SET status='cancelled' WHERE id=? AND user_id=?",
      ).run(job.subscription_id, job.user_id);
      audit(job.user_id, "cancellation.effective", job.subscription_id);
    }
    const jobs = db
      .prepare(
        "SELECT * FROM cancellation_jobs WHERE status IN ('queued','submitted','unknown') AND next_attempt<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY created LIMIT 20",
      )
      .all(ms, ms);
    for (const job of jobs) {
      const dispatchMs = ms + Date.now() - started;
      const write = job.status === "queued";
      if (write) {
        const cap = db
          .prepare(
            "SELECT * FROM cancellation_capabilities WHERE subscription_id=?",
          )
          .get(job.subscription_id);
        if (
          !cap?.enabled ||
          cap.provider_ref !== job.provider_ref ||
          cap.version !== job.capability_version ||
          Date.parse(cap.expires) <= dispatchMs
        ) {
          db.prepare(
            "UPDATE cancellation_jobs SET status='failed',error='Cancellation permission expired or changed before dispatch.',updated=? WHERE id=?",
          ).run(stamp, job.id);
          db.prepare(
            "UPDATE subscriptions SET status=? WHERE id=? AND user_id=? AND status='cancellation_requested'",
          ).run(job.prior_status, job.subscription_id, job.user_id);
          audit(
            job.user_id,
            "cancellation.permission_invalid",
            job.subscription_id,
          );
          continue;
        }
      }
      const claimed = db
        .prepare(
          "UPDATE cancellation_jobs SET lease_until=?,status=CASE WHEN status='queued' THEN 'processing' ELSE status END,attempts=attempts+1 WHERE id=? AND status=? AND (lease_until IS NULL OR lease_until<?)",
        )
        .run(dispatchMs + 90000, job.id, job.status, dispatchMs);
      if (!claimed.changes) continue;
      try {
        const result = await request(job, write ? "POST" : "GET");
        if (result.jobId !== job.id || result.providerRef !== job.provider_ref)
          throw Error("Cancellation reference mismatch");
        db.exec("BEGIN IMMEDIATE");
        try {
          applyCancellationResult(result, new Date(ms + Date.now() - started));
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        db.prepare(
          "UPDATE cancellation_jobs SET lease_until=NULL,next_attempt=? WHERE id=?",
        ).run(ms + Date.now() - started + 60000, job.id);
      } catch {
        db.prepare(
          "UPDATE cancellation_jobs SET status=CASE WHEN status='processing' THEN 'unknown' ELSE status END,lease_until=NULL,next_attempt=?,error='Awaiting provider confirmation. Cancellation is not confirmed.',updated=? WHERE id=? AND status IN ('processing','submitted','unknown')",
        ).run(
          ms + Math.min(900000, 60000 * 2 ** Math.min(job.attempts, 4)),
          stamp,
          job.id,
        );
      }
    }
  } finally {
    running = false;
  }
}
export function startCancellationWorker() {
  const sweep = () =>
    runCancellationWorker().catch(() =>
      console.error("Cancellation worker failed"),
    );
  sweep();
  const timer = setInterval(sweep, 15000);
  timer.unref();
  return () => clearInterval(timer);
}

export function reconcileCancellationStates() {
  db.exec(`UPDATE subscriptions SET status='cancelled' WHERE id IN (SELECT subscription_id FROM cancellation_jobs WHERE status='cancelled');
  UPDATE subscriptions SET status='cancellation_requested' WHERE id IN (SELECT subscription_id FROM cancellation_jobs WHERE status IN ('queued','processing','submitted','unknown','scheduled'));`);
}
