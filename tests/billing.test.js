import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(join(tmpdir(), "subwise-billing-")),
  dbPath = join(dir, "test.db"),
  base = "http://127.0.0.1:3100";
let child, db, token, user;
async function req(path, body, method) {
  const r = await fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      "x-client": "mobile",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
test.before(async () => {
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: "3100",
      DATABASE_PATH: dbPath,
      REQUIRE_PAID_PLAN: "true",
      ENABLE_TEST_PLUS: "false",
      OPENAI_API_KEY: "",
      RAZORPAY_KEY_ID: "test-key",
      RAZORPAY_KEY_SECRET: "test-secret",
      RAZORPAY_PLAN_ID: "plan-test",
      RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("API exited early")));
  });
  const r = await req("/api/auth/register", {
    email: "billing@example.com",
    password: "long-safe-test-password",
    name: "Paid tester",
  });
  token = r.data.token;
  user = r.data.user;
  db = new DatabaseSync(dbPath);
});
test.after(() => {
  db?.close();
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});
async function event(id, status, time, end) {
  const body = JSON.stringify({
    created_at: time,
    event: "subscription." + status,
    payload: {
      subscription: { entity: { id: "sub-test", status, current_end: end } },
    },
  });
  const r = await fetch(base + "/api/webhooks/razorpay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-event-id": id,
      "x-razorpay-signature": createHmac("sha256", "webhook-secret")
        .update(body)
        .digest("hex"),
    },
    body,
  });
  assert.equal(r.status, 200);
}
const input = {
  name: "Netflix",
  amount: 64900,
  cadence: "monthly",
  nextDate: "2026-11-05",
  category: "Entertainment",
  payment: "Card",
};
test("membership gates reads/writes, only valid webhooks unlock, old/replayed events cannot revoke access", async () => {
  assert.equal((await req("/api/dashboard")).data.access, false);
  assert.equal(
    (
      await req("/api/assistant", {
        message: "Review my payments",
        shareData: true,
      })
    ).status,
    402,
  );
  db.prepare(
    "INSERT INTO billing(user_id,provider_id,status) VALUES(?,?,?)",
  ).run(user.id, "sub-test", "created");
  db.prepare(
    "INSERT INTO subscriptions(id,user_id,name,amount,cadence,next_date,category,payment,status,source,created) VALUES('billing-fixture',?,'Netflix',64900,'monthly','2026-11-05','Entertainment','Card','active','card',?)",
  ).run(user.id, new Date().toISOString());
  const now = Math.floor(Date.now() / 1000);
  await event("evt-active", "active", now, now + 86400);
  assert.equal((await req("/api/dashboard")).data.access, true);
  assert.equal(
    (
      await req("/api/assistant", {
        message: "Review my payments",
        shareData: true,
      })
    ).status,
    503,
  );
  await event("evt-old", "cancelled", now - 1, now + 86400);
  await event("evt-active", "cancelled", now + 1, now + 86400);
  assert.equal((await req("/api/dashboard")).data.access, true);
  await event("evt-cancelled", "cancelled", now + 2, now + 86400);
  const locked = await req("/api/dashboard");
  assert.equal(locked.data.access, false);
  assert.equal(locked.data.subscriptions.length, 0);
  assert.equal(
    (
      await req("/api/assistant", {
        message: "Review my payments",
        shareData: true,
      })
    ).status,
    402,
  );
  assert.equal((await req("/api/export")).data.subscriptions.length, 1);
});
