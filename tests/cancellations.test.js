import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
const dir = mkdtempSync(join(tmpdir(), "subwise-cancel-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
process.env.CANCELLATION_CONNECTOR_URL = "https://authorized-adapter.example";
process.env.CANCELLATION_CONNECTOR_SECRET = "fixture-secret";
process.env.CANCELLATION_WEBHOOK_SECRET = "fixture-webhook";
const { db } = await import("../server/db.js");
const c = await import("../server/cancellations.js");
let server, base;
let owner = randomUUID();
const other = randomUUID(),
  now = new Date(Date.now() + 60000);
function sub(user = owner) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO subscriptions(id,user_id,name,amount,cadence,next_date,category,payment,source,created) VALUES(?,?,'Netflix',64900,'monthly','2026-11-05','Entertainment','Card','card',?)",
  ).run(id, user, now.toISOString());
  return id;
}
function job(id) {
  return db
    .prepare("SELECT * FROM cancellation_jobs WHERE subscription_id=?")
    .get(id);
}
function status(id) {
  return db.prepare("SELECT status FROM subscriptions WHERE id=?").get(id)
    .status;
}
function cap(id, overrides = {}) {
  return {
    id: randomUUID(),
    type: "capability",
    subscriptionId: id,
    providerRef: "merchant-" + randomUUID(),
    scope: "subscription",
    enabled: true,
    version: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  };
}
async function webhook(event, { age = 0, invalid = false } = {}) {
  const body = JSON.stringify(event),
    timestamp = String(Math.floor(Date.now() / 1000) - age),
    sig = createHmac("sha256", process.env.CANCELLATION_WEBHOOK_SECRET)
      .update(timestamp + "." + body)
      .digest("hex");
  const r = await fetch(base + "/api/webhooks/cancellations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-subwise-timestamp": timestamp,
      "x-subwise-signature": invalid ? "0".repeat(64) : sig,
    },
    body,
  });
  return { status: r.status, data: await r.json() };
}
async function cancel(
  id,
  body = { confirm: true, capabilityVersion: 1 },
  user = owner,
) {
  const r = await fetch(base + "/api/subscriptions/" + id + "/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: user },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
function confirmed(j, overrides = {}) {
  return {
    jobId: j.id,
    providerRef: j.provider_ref,
    sequence: 2,
    status: "cancelled",
    reference: "receipt-" + j.id,
    renewalStopped: true,
    effectiveAt: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}
async function sweep(options = {}) {
  await c.runCancellationWorker({ now, ...options });
}
// Keep independent test jobs from being picked up by a later test's worker fixture.
test.beforeEach(() => {
  owner = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    owner,
    owner + "@example.com",
    "Customer",
    "fixture-hash",
    now.toISOString(),
  );
  db.prepare(
    "UPDATE cancellation_jobs SET next_attempt=? WHERE status IN ('queued','submitted','unknown')",
  ).run(Date.now() + 30 * 86400000);
});
test.before(async () => {
  for (const id of [owner, other])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      id,
      id + "@example.com",
      "Customer",
      "fixture-hash",
      now.toISOString(),
    );
  const app = express();
  c.registerCancellationWebhook(app);
  app.use(express.json());
  c.registerCancellationRoutes(app, {
    auth: (req, res, next) => {
      const id = req.get("Authorization");
      if (![owner, other].includes(id))
        return res.status(401).json({ error: "Sign in" });
      req.user = { id };
      next();
    },
    paid: (req, res, next) =>
      req.get("x-no-plan") ? res.sendStatus(402) : next(),
    dispatch: async () => {},
  });
  app.use((err, req, res, next) =>
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: err.name }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(() => {
  server?.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
test("no cancellation without ownership, affirmative consent and an authorized capability", async () => {
  const id = sub();
  assert.equal((await cancel(id)).status, 409);
  assert.equal((await cancel(id, undefined, other)).status, 404);
  assert.equal(
    (await cancel(id, { confirm: false, capabilityVersion: 1 })).status,
    400,
  );
  assert.equal(
    (
      await cancel(id, {
        confirm: true,
        capabilityVersion: 1,
        providerRef: "forged",
      })
    ).status,
    400,
  );
  assert.equal(status(id), "active");
});
test("capability events enforce signature, replay window, subscription scope and sequence", async () => {
  const id = sub(),
    event = cap(id);
  assert.equal((await webhook(event, { invalid: true })).status, 401);
  assert.equal((await webhook(event, { age: 600 })).status, 401);
  assert.equal((await webhook({ ...event, scope: "mandate" })).status, 400);
  assert.equal((await webhook(event)).status, 200);
  assert.equal((await webhook(event)).data.duplicate, true);
  await webhook({ ...event, id: randomUUID(), enabled: false, version: 2 });
  await webhook({ ...event, id: randomUUID(), version: 1 });
  assert.equal(c.cancellationDetails(id).available, false);
  assert.equal((await cancel(id)).status, 409);
});
test("queued jobs are idempotent and stale capability versions are rejected", async () => {
  const id = sub();
  await webhook(cap(id, { version: 3 }));
  assert.equal((await cancel(id)).status, 409);
  const r = await cancel(id, { confirm: true, capabilityVersion: 3 });
  assert.equal(r.status, 202);
  assert.equal(r.data.job.status, "queued");
  assert.equal(status(id), "cancellation_requested");
  assert.equal(
    (await cancel(id, { confirm: true, capabilityVersion: 3 })).data.job.id,
    r.data.job.id,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM cancellation_jobs WHERE subscription_id=?",
      )
      .get(id).n,
    1,
  );
});
test("accepted request remains pending until verified confirmation; scheduled cancellation takes effect later", async () => {
  const id = sub();
  await webhook(cap(id));
  await cancel(id);
  const j = job(id),
    calls = [];
  await sweep({
    request: async (j, method) => {
      calls.push(method);
      return {
        jobId: j.id,
        providerRef: j.provider_ref,
        sequence: 1,
        status: "submitted",
      };
    },
  });
  assert.equal(status(id), "cancellation_requested");
  assert.equal(job(id).status, "submitted");
  const end = new Date(now.getTime() + 3600000).toISOString();
  await c.runCancellationWorker({
    now: new Date(now.getTime() + 61000),
    request: async (j, method) => {
      calls.push(method);
      return confirmed(j, { status: "scheduled", effectiveAt: end });
    },
  });
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(job(id).status, "scheduled");
  assert.equal(status(id), "cancellation_requested");
  assert.ok(c.cancellationDetails(id).job.confirmation);
  await c.runCancellationWorker({
    now: new Date(now.getTime() + 3600001),
    request: async () => {
      throw Error("Should not call provider after confirmation");
    },
  });
  assert.equal(job(id).status, "cancelled");
  assert.equal(status(id), "cancelled");
});
test("an ambiguous response is reconciled with GET, never submitted twice", async () => {
  const id = sub();
  await webhook(cap(id));
  await cancel(id);
  const calls = [];
  await sweep({
    request: async (j, method) => {
      calls.push(method);
      throw Error("timeout after provider received request");
    },
  });
  assert.equal(job(id).status, "unknown");
  assert.equal(status(id), "cancellation_requested");
  await c.runCancellationWorker({
    now: new Date(now.getTime() + 120000),
    request: async (j, method) => {
      calls.push(method);
      return confirmed(j);
    },
  });
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(status(id), "cancelled");
});
test("wrong job references and incomplete proof never cancel the subscription", async () => {
  const id = sub();
  await webhook(cap(id));
  await cancel(id);
  await sweep({
    request: async (j) => confirmed(j, { providerRef: "someone-else" }),
  });
  assert.equal(job(id).status, "unknown");
  assert.equal(status(id), "cancellation_requested");
  const j = job(id);
  assert.equal(
    (
      await webhook({
        id: randomUUID(),
        type: "result",
        result: confirmed(j, { renewalStopped: false }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await webhook({
        id: randomUUID(),
        type: "result",
        result: confirmed(j, { effectiveAt: undefined }),
      })
    ).status,
    409,
  );
  assert.equal(status(id), "cancellation_requested");
  const event = { id: randomUUID(), type: "result", result: confirmed(j) };
  assert.equal((await webhook(event)).status, 200);
  assert.equal((await webhook(event)).data.duplicate, true);
  assert.equal(status(id), "cancelled");
  await webhook({
    id: randomUUID(),
    type: "result",
    result: confirmed(j, { sequence: 1, status: "submitted" }),
  });
  assert.equal(job(id).status, "cancelled");
});
test("permission revocation before dispatch prevents every external write", async () => {
  const id = sub(),
    event = cap(id);
  await webhook(event);
  await cancel(id);
  await webhook({ ...event, id: randomUUID(), version: 2, enabled: false });
  let calls = 0;
  await sweep({
    request: async () => {
      calls++;
      throw Error("Must not send");
    },
  });
  assert.equal(calls, 0);
  assert.equal(job(id).status, "failed");
  assert.equal(status(id), "active");
});
test("worker crash recovers through read-only reconciliation and ignores stale notifications", async () => {
  const id = sub();
  await webhook(cap(id));
  await cancel(id);
  db.prepare(
    "UPDATE cancellation_jobs SET status='processing',lease_until=? WHERE subscription_id=?",
  ).run(now.getTime() - 1, id);
  let method;
  await sweep({
    request: async (j, m) => {
      method = m;
      return confirmed(j, {
        sequence: 5,
        status: "scheduled",
        effectiveAt: new Date(now.getTime() + 86400000).toISOString(),
      });
    },
  });
  assert.equal(method, "GET");
  const j = job(id);
  await webhook({
    id: randomUUID(),
    type: "result",
    result: confirmed(j, { sequence: 4, status: "failed" }),
  });
  assert.equal(job(id).status, "scheduled");
  assert.equal(c.cancellationInProgress(owner, id), true);
  assert.equal(c.cancellationInProgress(other, id), false);
  db.prepare("UPDATE subscriptions SET status='active' WHERE id=?").run(id);
  c.reconcileCancellationStates();
  assert.equal(status(id), "cancellation_requested");
});
test("a definitive provider failure is visible and never reported as cancelled", async () => {
  const id = sub();
  await webhook(cap(id));
  await cancel(id);
  await sweep({
    request: async (j) => ({
      jobId: j.id,
      providerRef: j.provider_ref,
      sequence: 1,
      status: "failed",
    }),
  });
  assert.equal(job(id).status, "failed");
  assert.equal(status(id), "active");
  assert.ok(c.cancellationDetails(id).job.error);
});

test("HTTPS transport uses a stable idempotency key, exact bound reference, and read-only status checks", async () => {
  const id = sub();
  await webhook(cap(id));
  await cancel(id);
  const originalFetch = global.fetch,
    calls = [];
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, "https://authorized-adapter.example");
    calls.push({ url: String(url), ...options });
    const j = job(id);
    return Response.json(
      options.method === "POST"
        ? {
            jobId: j.id,
            providerRef: j.provider_ref,
            sequence: 1,
            status: "submitted",
          }
        : confirmed(j),
    );
  };
  try {
    await sweep();
    await c.runCancellationWorker({ now: new Date(now.getTime() + 61000) });
  } finally {
    global.fetch = originalFetch;
  }
  assert.deepEqual(
    calls.map((x) => x.method),
    ["POST", "GET"],
  );
  assert.equal(calls[0].redirect, "error");
  assert.equal(
    calls[0].headers["Idempotency-Key"],
    calls[1].headers["Idempotency-Key"],
  );
  const body = JSON.parse(calls[0].body);
  assert.equal(body.action, "cancel_subscription");
  assert.equal(body.timing, "period_end");
  assert.equal(body.providerRef, job(id).provider_ref);
  assert.ok(body.authorizedAt);
  assert.equal(status(id), "cancelled");
});

test("a failed cancellation preserves an unresolved detected subscription review state", async () => {
  const id = sub();
  db.prepare("UPDATE subscriptions SET status='needs_review' WHERE id=?").run(
    id,
  );
  await webhook(cap(id));
  await cancel(id);
  await sweep({
    request: async (j) => ({
      jobId: j.id,
      providerRef: j.provider_ref,
      sequence: 1,
      status: "failed",
    }),
  });
  assert.equal(status(id), "needs_review");
});
