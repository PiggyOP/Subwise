import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
const dir = mkdtempSync(join(tmpdir(), "subwise-email-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
process.env.RESEND_API_KEY = "test-no-network";
process.env.EMAIL_FROM = "Subwise <test@example.com>";
process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
process.env.APP_ORIGIN = "https://subwise.example";
const { db } = await import("../server/db.js");
const mail = await import("../server/email.js");
const { registerProfileRoutes } = await import("../server/profile.js");
const realFetch = global.fetch;
let captured = [],
  failProvider = false,
  server,
  base;
global.fetch = async (url, opts) => {
  if (String(url) === "https://api.resend.com/emails") {
    captured.push(JSON.parse(opts.body));
    return failProvider
      ? new Response("{}", {
          status: 503,
        })
      : Response.json({
          id: "email-" + randomUUID(),
        });
  }
  return realFetch(url, opts);
};
function user() {
  const u = {
    id: randomUUID(),
    name: "Email Customer",
    email: randomUUID() + "@example.com",
    password: "stored-hash",
    created: new Date().toISOString(),
  };
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    u.id,
    u.email,
    u.name,
    u.password,
    u.created,
  );
  return u;
}
async function req(route, body, u, method) {
  const r = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(u
        ? {
            Authorization: u.id,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json().catch(() => null),
  };
}
test.before(async () => {
  const app = express();
  app.use(express.json());
  registerProfileRoutes(app, {
    auth: (req, res, next) => {
      const u = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(req.get("authorization") || "");
      if (!u) return res.sendStatus(401);
      req.user = u;
      next();
    },
    verifyPassword: async (password) => password === "correct-password",
  });
  app.use((e, req, res, next) =>
    res.status(400).json({
      error: "Invalid request",
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(() => {
  global.fetch = realFetch;
  server?.close();
  db.close();
  rmSync(dir, {
    recursive: true,
    force: true,
  });
});
test("monthly schedule uses 09:00 India time and handles year rollover", () => {
  assert.equal(
    mail.nextMonthlySend(new Date("2026-10-31T20:00:00Z"), 1),
    "2026-11-01T03:30:00.000Z",
  );
  assert.equal(
    mail.nextMonthlySend(new Date("2026-12-28T04:00:00Z"), 28),
    "2027-01-28T03:30:00.000Z",
  );
});
test("profile persists email preferences, verifies ownership, and protects email changes", async () => {
  const u = user();
  assert.equal((await req("/api/profile")).status, 401);
  const p = await req("/api/profile", null, u);
  assert.equal(p.data.email, u.email);
  assert.equal(p.data.emailVerified, false);
  assert.equal(
    (
      await req(
        "/api/profile",
        {
          name: "Updated Name",
          monthlyEnabled: true,
          monthlyDay: 12,
        },
        u,
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal((await req("/api/profile", null, u)).data.monthlyEnabled, true);
  assert.equal((await req("/api/profile/email/test", {}, u)).status, 409);
  const sent = await req(
    "/api/profile/email/request",
    {
      email: u.email,
    },
    u,
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.data.code, undefined);
  const code = captured.at(-1).text.match(/\b\d{6}\b/)[0];
  assert.equal(
    (
      await req(
        "/api/profile/email/verify",
        {
          code: "000000",
        },
        u,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        "/api/profile/email/verify",
        {
          code,
        },
        u,
      )
    ).data.emailVerified,
    true,
  );
  assert.equal(
    (
      await req(
        "/api/profile/email/verify",
        {
          code,
        },
        u,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        "/api/profile/email/request",
        {
          email: "another@example.com",
        },
        u,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await req(
        "/api/profile/email/request",
        {
          email: "another@example.com",
          currentPassword: "correct-password",
        },
        u,
      )
    ).status,
    200,
  );
  const changedCode = captured.at(-1).text.match(/\b\d{6}\b/)[0];
  const changed = await req(
    "/api/profile/email/verify",
    {
      code: changedCode,
    },
    u,
  );
  assert.equal(changed.data.email, "another@example.com");
  assert.equal(
    db.prepare("SELECT email FROM users WHERE id=?").get(u.id).email,
    "another@example.com",
  );
});
test("monthly worker sends only verified opt-ins and prevents duplicate monthly messages", async () => {
  const a = user(),
    b = user();
  for (const u of [a, b]) await mail.ensureProfile(u.id);
  db.prepare(
    "UPDATE profiles SET verified_email=?,monthly_enabled=1,monthly_day=1,next_send_at='2026-10-01T03:30:00.000Z' WHERE user_id=?",
  ).run(a.email, a.id);
  db.prepare(
    "UPDATE profiles SET monthly_enabled=1,next_send_at='2026-10-01T03:30:00.000Z' WHERE user_id=?",
  ).run(b.id);
  const sent = [];
  const now = new Date("2026-10-01T04:00:00Z");
  const sender = async (p, key) => {
    sent.push({
      p,
      key,
    });
    return "test-id";
  };
  await mail.runMonthlyEmails({
    now,
    mailer: sender,
    configured: true,
  });
  await mail.runMonthlyEmails({
    now,
    mailer: sender,
    configured: true,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].p.to[0], a.email);
  assert.ok(sent[0].p.text.includes("not a bank statement"));
  assert.equal(
    db.prepare("SELECT next_send_at FROM profiles WHERE user_id=?").get(a.id)
      .next_send_at,
    "2026-11-01T03:30:00.000Z",
  );
});
test("unsubscribe validates token and cancels pending monthly mail", async () => {
  const u = user();
  await mail.ensureProfile(u.id);
  db.prepare(
    "UPDATE profiles SET monthly_enabled=1,verified_email=? WHERE user_id=?",
  ).run(u.email, u.id);
  await mail.enqueueSummary(u, "monthly");
  const token = mail.unsubscribeToken(u);
  assert.equal(
    (
      await realFetch(
        base + "/api/email/unsubscribe?id=" + u.id + "&token=wrong",
        {
          method: "POST",
        },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await realFetch(
        base + "/api/email/unsubscribe?id=" + u.id + "&token=" + token,
        {
          method: "POST",
        },
      )
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT monthly_enabled FROM profiles WHERE user_id=?").get(u.id)
      .monthly_enabled,
    0,
  );
  assert.equal(
    db.prepare("SELECT status FROM email_outbox WHERE user_id=?").get(u.id)
      .status,
    "cancelled",
  );
});
test("provider outage is recorded and retries reuse the same idempotency key", async () => {
  const u = user();
  await mail.ensureProfile(u.id);
  db.prepare("UPDATE profiles SET verified_email=? WHERE user_id=?").run(
    u.email,
    u.id,
  );
  const now = new Date("2026-12-01T04:00:00Z"),
    id = await mail.enqueueSummary(u, "test", now),
    keys = [];
  await mail.runMonthlyEmails({
    now,
    configured: true,
    mailer: async (p, key) => {
      if (key !== `subwise/${id}`) return "other-accepted";
      keys.push(key);
      throw Error("outage");
    },
  });
  assert.equal(
    db.prepare("SELECT status FROM email_outbox WHERE id=?").get(id).status,
    "queued",
  );
  await mail.runMonthlyEmails({
    now: new Date(now.getTime() + 180000),
    configured: true,
    mailer: async (p, key) => {
      keys.push(key);
      return "accepted-after-retry";
    },
  });
  assert.equal(keys[0], keys[1]);
  assert.equal(
    db.prepare("SELECT status FROM email_outbox WHERE id=?").get(id).status,
    "accepted",
  );
});
