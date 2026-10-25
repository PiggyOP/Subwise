import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = mkdtempSync(join(tmpdir(), "subwise-plus-"));
const email = "private-plus@example.com",
  password = "fixture-account-passphrase";
const salt = randomBytes(16).toString("hex");
const hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
let child;
const base = "http://127.0.0.1:3197";
async function request(path, body, token) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client": "mobile",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
test.before(async () => {
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      DATABASE_PATH: join(directory, "plus.sqlite"),
      PORT: "3197",
      NODE_ENV: "production",
      APP_ORIGIN: "https://subwise.example",
      ENABLE_TEST_PLUS: "false",
      REQUIRE_PAID_PLAN: "true",
      PLUS_TEST_EMAIL: email,
      PLUS_TEST_PASSWORD_HASH: hash,
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      RAZORPAY_PLAN_ID: "",
      RAZORPAY_WEBHOOK_SECRET: "",
      FINANCIAL_CONNECTOR_URL: "",
      OPENAI_API_KEY: "",
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("Plus API exited")));
  });
});
test.after(() => {
  child?.kill();
  rmSync(directory, { recursive: true, force: true });
});
test("production Plus gate denies ordinary accounts and privately grants only the provisioned test account", async () => {
  assert.equal(
    (
      await request("/api/auth/login", {
        email,
        password: "incorrect-passphrase",
      })
    ).status,
    401,
  );
  const login = await request("/api/auth/login", { email, password });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const premium = (await request("/api/dashboard", null, token)).body;
  assert.equal(premium.access, true);
  assert.equal(premium.billing.status, "active");
  assert.equal(premium.billing.complimentary, true);
  assert.equal(premium.integrations.testPlus, false);
  assert.equal(premium.integrations.paidGate, true);
  assert.equal((await request("/api/billing/checkout", {}, token)).status, 409);
  assert.equal((await request("/api/billing/cancel", {}, token)).status, 409);
  const normal = await request("/api/auth/register", {
    email: "normal-plus@example.com",
    password: "normal-account-passphrase",
    name: "Normal account",
  });
  assert.equal(normal.status, 201);
  const ordinary = normal.body.token;
  const locked = (await request("/api/dashboard", null, ordinary)).body;
  assert.equal(locked.access, false);
  assert.equal(locked.billing.status, "unsubscribed");
  assert.deepEqual(locked.subscriptions, []);
  assert.equal(
    (await request("/api/connections", { channel: "card" }, ordinary)).status,
    402,
  );
  assert.equal(
    (
      await request(
        "/api/assistant",
        { message: "Review my payments", shareData: true },
        ordinary,
      )
    ).status,
    402,
  );
  assert.equal(
    (await request("/api/billing/checkout", {}, ordinary)).status,
    503,
  );
  assert.equal((await request("/api/profile", null, ordinary)).status, 200);
});
