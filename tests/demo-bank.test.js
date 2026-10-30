import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scryptSync, randomBytes } from "node:crypto";
import { demoStatement } from "../server/demo-bank-data.js";
import { detectRecurring } from "../server/detection.js";

const dir = mkdtempSync(join(tmpdir(), "subwise-demo-"));
const base = "http://127.0.0.1:3193",
  email = "demo-owner@example.com",
  password = "demo-account-test-pass";
const salt = randomBytes(16).toString("hex");
let child;
async function request(path, body, token) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client": "mobile",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
test.before(async () => {
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      SUBWISE_SERVERLESS: "",
      NETLIFY: "",
      DATABASE_PATH: join(dir, "test.sqlite"),
      PORT: "3193",
      NODE_ENV: "production",
      APP_ORIGIN: "https://subwise.example",
      ENABLE_TEST_PLUS: "false",
      REQUIRE_PAID_PLAN: "true",
      PLUS_TEST_EMAIL: email,
      PLUS_TEST_PASSWORD_HASH:
        salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      DEMO_BANK_ENABLED: "true",
      DEMO_BANK_EMAILS: email + ",unpaid-demo@example.com",
      SETU_SANDBOX_ENABLED: "false",
      FINANCIAL_CONNECTOR_URL: "",
      CANCELLATION_CONNECTOR_URL: "",
      OPENAI_API_KEY: "",
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("Demo API exited")));
  });
});
test.after(() => {
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});

test("mixed statement establishes monthly evidence while everyday payments establish none", () => {
  for (const anchor of [
    new Date("2026-10-30T12:00:00Z"),
    new Date("2027-01-02T12:00:00Z"),
  ]) {
    const data = demoStatement("9000000000", anchor);
    const found = detectRecurring([
      ...new Map(data.transactions.map((t) => [t.id, t])).values(),
    ]);
    assert.equal(data.transactions.length, 33);
    assert.deepEqual(
      found.map((x) => x.name).sort(),
      ["Netflix", "Spotify Premium", "NACH/HARBOR FITNESS", "iCloud+"].sort(),
    );
    assert.ok(
      found.every((x) => x.evidenceCount === 3 && x.cadence === "monthly"),
    );
    assert.ok(
      data.transactions.every(
        (t) => t.date <= anchor.toISOString().slice(0, 10),
      ),
    );
    assert.equal(
      detectRecurring(demoStatement("9000000001", anchor).transactions).length,
      0,
    );
  }
});
test("demo requires existing account, explicit allowlist and Plus; persists only selected synthetic subscriptions without replay duplicates", async () => {
  assert.equal((await request("/api/demo-bank")).status, 401);
  const login = await request("/api/auth/login", { email, password });
  assert.equal(login.status, 200);
  const token = login.data.token;
  const bad = await request(
    "/api/demo-bank/connect",
    { number: "9000000000", code: "000000" },
    token,
  );
  assert.equal(bad.status, 400);
  assert.deepEqual(
    (await request("/api/demo-bank", null, token)).data.accounts,
    [],
  );
  assert.equal(
    (
      await request(
        "/api/demo-bank/connect",
        { number: "8123456789", code: "123456" },
        token,
      )
    ).status,
    400,
  );
  const mixed = await request(
    "/api/demo-bank/connect",
    { number: "9000000000", code: "123456" },
    token,
  );
  assert.equal(mixed.status, 200);
  assert.equal(mixed.data.accounts[0].subscriptions.length, 5);
  const dashboard = (await request("/api/dashboard", null, token)).data;
  assert.equal(dashboard.subscriptions.length, 5);
  assert.ok(
    dashboard.subscriptions.every(
      (s) =>
        s.source === "demo_bank" &&
        s.payment === "Demo bank · synthetic" &&
        !s.cancellation.available,
    ),
  );
  assert.equal(dashboard.transactions.length, 32);
  const annual = dashboard.subscriptions.find((s) => s.cadence === "yearly");
  assert.ok(annual);
  assert.equal(annual.confidence, 1);
  const replay = await request(
    "/api/demo-bank/connect",
    { number: "9000000000", code: "123456" },
    token,
  );
  assert.equal(replay.data.accounts.length, 1);
  const again = (await request("/api/dashboard", null, token)).data;
  assert.equal(again.subscriptions.length, 5);
  assert.equal(again.transactions.length, 32);
  const ordinary = await request(
    "/api/demo-bank/connect",
    { number: "9000000001", code: "123456" },
    token,
  );
  assert.equal(ordinary.data.accounts.length, 2);
  assert.equal(
    ordinary.data.accounts.find((a) => a.statement.account.endsWith("0001"))
      .subscriptions.length,
    0,
  );
  const other = await request("/api/auth/register", {
    email: "other-demo@example.com",
    name: "Other",
    password,
  });
  assert.equal(
    (await request("/api/demo-bank", null, other.data.token)).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/demo-bank/connect",
        { number: "9000000000", code: "123456" },
        other.data.token,
      )
    ).status,
    404,
  );
  assert.deepEqual(
    (await request("/api/dashboard", null, other.data.token)).data
      .subscriptions,
    [],
  );
  const unpaid = await request("/api/auth/register", {
    email: "unpaid-demo@example.com",
    name: "Unpaid",
    password,
  });
  assert.equal(
    (
      await request(
        "/api/demo-bank/connect",
        { number: "9000000000", code: "123456" },
        unpaid.data.token,
      )
    ).status,
    402,
  );
});
