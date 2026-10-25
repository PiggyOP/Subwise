import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(join(tmpdir(), "subwise-feeds-")),
  path = join(dir, "db.sqlite"),
  base = "http://127.0.0.1:3102";
let child, db, user, token, card, upi;
async function req(route, body) {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client": "mobile",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function event(e, { sig = true, age = 0 } = {}) {
  const body = JSON.stringify(e),
    timestamp = String(Math.floor(Date.now() / 1000) - age);
  const signature = createHmac("sha256", "test-webhook")
    .update(timestamp + "." + body)
    .digest("hex");
  const r = await fetch(base + "/api/webhooks/financial", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-subwise-timestamp": timestamp,
      "x-subwise-signature": sig ? signature : "invalid",
    },
    body,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
test.before(async () => {
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: "3102",
      DATABASE_PATH: path,
      ENABLE_TEST_PLUS: "false",
      REQUIRE_PAID_PLAN: "false",
      FINANCIAL_CONNECTOR_URL: "https://contracted-adapter.example",
      FINANCIAL_CONNECTOR_SECRET: "test-adapter",
      FINANCIAL_WEBHOOK_SECRET: "test-webhook",
      FINANCIAL_CONNECTOR_CHANNELS: "card,upi",
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("API exited")));
  });
  db = new DatabaseSync(path);
  const r = await req("/api/auth/register", {
    email: "feeds@example.com",
    password: "long-safe-password",
    name: "Feed test",
  });
  user = r.data.user;
  token = r.data.token;
  card = randomUUID();
  upi = randomUUID();
  for (const [id, c] of [
    [card, "card"],
    [upi, "upi"],
  ])
    db.prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)").run(
      id,
      user.id,
      c,
      "pending",
      null,
      new Date().toISOString(),
    );
});
test.after(() => {
  db?.close();
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});
test("signed card feed automatically detects monthly and annual subscriptions, no manual entry", async () => {
  const year = new Date().getUTCFullYear(),
    month = new Date().getUTCMonth();
  const monthly = [-2, -1, 0].map((offset, i) => ({
    id: "netflix-" + i,
    merchant: "NETFLIX",
    amount: 64900,
    date: new Date(Date.UTC(year, month + offset, 5))
      .toISOString()
      .slice(0, 10),
    currency: "INR",
  }));
  const annual = [year - 2, year - 1, year].map((y, i) => ({
    id: "notion-" + i,
    merchant: "NOTION",
    amount: 960000,
    date: `${y}-01-05`,
    currency: "INR",
  }));
  const e = {
    id: "evt-card",
    connectionId: card,
    status: "connected",
    transactions: [...monthly, ...annual],
  };
  assert.equal((await event(e, { sig: false })).status, 401);
  assert.equal((await event(e, { age: 600 })).status, 401);
  assert.equal((await event({ ...e, connectionId: randomUUID() })).status, 404);
  assert.equal((await event(e)).data.added, 6);
  assert.equal((await event(e)).data.duplicate, true);
  const dash = (await req("/api/dashboard")).data;
  assert.equal(dash.subscriptions.length, 2);
  assert.ok(dash.subscriptions.every((s) => s.source === "card"));
  assert.equal(
    dash.subscriptions.find((s) => s.name === "Netflix").cadence,
    "monthly",
  );
  assert.equal(
    dash.subscriptions.find((s) => s.name === "Notion").cadence,
    "yearly",
  );
  const repeat = await event({ ...e, id: "evt-card-new" });
  assert.equal(repeat.data.added, 0);
  assert.equal((await req("/api/dashboard")).data.subscriptions.length, 2);
});
test("UPI feed detection, provider transaction IDs and consent revocation", async () => {
  const year = new Date().getUTCFullYear();
  const transactions = [7, 8, 9].map((m, i) => ({
    id: "upi-" + i,
    merchant: "SPOTIFY",
    amount: 11900,
    date: `${year}-0${m}-12`,
    currency: "INR",
  }));
  assert.equal(
    (
      await event({
        id: "upi-feed",
        connectionId: upi,
        status: "connected",
        transactions,
      })
    ).status,
    200,
  );
  assert.equal(
    (await req("/api/dashboard")).data.subscriptions.find(
      (s) => s.name === "Spotify Premium",
    ).source,
    "upi",
  );
  assert.equal(
    (await event({ id: "revoked", connectionId: upi, status: "revoked" }))
      .status,
    200,
  );
  assert.equal(
    (
      await event({
        id: "late-data",
        connectionId: upi,
        status: "connected",
        transactions,
      })
    ).status,
    409,
  );
  assert.equal(
    (await req("/api/connections")).data.find((c) => c.id === upi).status,
    "revoked",
  );
});
test("provider-identified annual stream appears without waiting three years", async () => {
  const e = {
    id: "annual-identified",
    connectionId: card,
    status: "connected",
    recurring: [
      {
        id: "annual-icloud",
        merchant: "iCloud",
        amount: 90000,
        cadence: "yearly",
        nextDate: "2027-01-12",
        currency: "INR",
        status: "active",
      },
    ],
  };
  assert.equal((await event(e)).status, 200);
  const row = (await req("/api/dashboard")).data.subscriptions.find(
    (s) => s.name === "iCloud+",
  );
  assert.equal(row.cadence, "yearly");
  assert.equal(row.confidence, 1);
  assert.equal(row.amount, 90000);
  assert.equal(
    (
      await event({
        ...e,
        id: "annual-updated",
        recurring: [{ ...e.recurring[0], amount: 120000 }],
      })
    ).status,
    200,
  );
  assert.equal(
    (await req("/api/dashboard")).data.subscriptions.filter(
      (s) => s.name === "iCloud+",
    ).length,
    1,
  );
});

test("authoritative stream upgrades preserve cancellation permissions and confirmed state", async () => {
  const existing = (await req("/api/dashboard")).data.subscriptions.find(
    (s) => s.name === "Netflix",
  );
  db.prepare("INSERT INTO cancellation_capabilities VALUES(?,? ,1,1,?,?)").run(
    existing.id,
    "netflix-fixture-permission",
    new Date(Date.now() + 86400000).toISOString(),
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO cancellation_jobs(id,user_id,subscription_id,provider_ref,capability_version,status,consent_at,created,updated,next_attempt,receipt,effective_at) VALUES(?,?,?,?,1,'cancelled',?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    user.id,
    existing.id,
    "netflix-fixture-permission",
    new Date().toISOString(),
    new Date().toISOString(),
    new Date().toISOString(),
    Date.now(),
    "fixture-cancel-receipt",
    new Date().toISOString(),
  );
  const r = await event({
    id: "netflix-authoritative",
    connectionId: card,
    status: "connected",
    recurring: [
      {
        id: "netflix-provider-stream",
        merchant: "NETFLIX",
        amount: 64900,
        cadence: "monthly",
        nextDate: "2026-11-05",
        currency: "INR",
        status: "active",
      },
    ],
  });
  assert.equal(r.status, 200);
  const current = (await req("/api/dashboard")).data.subscriptions.filter(
    (s) => s.name === "Netflix",
  );
  assert.equal(current.length, 1);
  assert.equal(current[0].id, existing.id);
  assert.equal(current[0].status, "cancelled");
  assert.equal(
    current[0].cancellation.job.confirmation,
    "fixture-cancel-receipt",
  );
  assert.ok(
    db
      .prepare(
        "SELECT * FROM cancellation_capabilities WHERE subscription_id=?",
      )
      .get(existing.id),
  );
});
