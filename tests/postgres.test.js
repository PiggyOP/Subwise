import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createPostgresDatabase, postgresSQL } from "../server/postgres.js";

// This suite uses an isolated schema, never the configured production database.
const connectionString = process.env.TEST_DATABASE_URL;
test("PostgreSQL SQL conversion preserves quoted text and binds parameters", () => {
  assert.equal(
    postgresSQL("SELECT '? INTEGER REAL', \"?\" FROM users WHERE id=?"),
    "SELECT '? INTEGER REAL', \"?\" FROM users WHERE id=$1",
  );
  assert.equal(
    postgresSQL("INSERT OR IGNORE INTO profiles(user_id) VALUES(?)"),
    "INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING",
  );
});

test(
  "PostgreSQL persists accounts and isolates concurrent transactions",
  { skip: !connectionString },
  async (t) => {
    const schema = "test_" + randomUUID().replaceAll("-", "");
    const admin = new pg.Pool({ connectionString });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(connectionString);
    url.searchParams.set("options", "-c search_path=" + schema);
    const pool = new pg.Pool({ connectionString: url.href, max: 4 });
    const db = createPostgresDatabase(pool);
    let child, base, functionDb;
    async function start() {
      child = spawn(process.execPath, ["server/index.js"], {
        env: {
          ...process.env,
          DATABASE_URL: url.href,
          PORT: "3198",
          NODE_ENV: "production",
          APP_ORIGIN: "https://subwise.example",
          ENABLE_TEST_PLUS: "false",
          REQUIRE_PAID_PLAN: "false",
          FINANCIAL_CONNECTOR_URL: "https://fixture.example",
          FINANCIAL_CONNECTOR_SECRET: "fixture-only",
          FINANCIAL_CONNECTOR_CHANNELS: "card,upi",
          FINANCIAL_WEBHOOK_SECRET: "test-webhook-only",
          CANCELLATION_CONNECTOR_URL: "",
          OPENAI_API_KEY: "",
          RESEND_API_KEY: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("PostgreSQL API startup timed out")),
          15000,
        );
        child.stdout.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("PostgreSQL API exited"));
        });
        child.stderr.on("data", () => {});
      });
      base = "http://127.0.0.1:3198";
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    async function req(route, body, token, method) {
      const response = await fetch(base + route, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          "Content-Type": "application/json",
          "x-client": "mobile",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    }
    try {
      await start();
      let token, user;
      await t.test(
        "registration, secure session, stored profile, and process restart",
        async () => {
          const registered = await req("/api/auth/register", {
            email: "postgres@example.com",
            name: "Database customer",
            password: "test-passphrase-long",
          });
          assert.equal(registered.status, 201);
          token = registered.body.token;
          user = registered.body.user;
          assert.ok(token);
          assert.equal((await req("/api/dashboard")).status, 401);
          const profile = await req(
            "/api/profile",
            {
              name: "Persisted customer",
              monthlyEnabled: false,
              monthlyDay: 12,
            },
            token,
            "PATCH",
          );
          assert.equal(profile.status, 200);
          assert.equal(profile.body.name, "Persisted customer");
          const stored = await db
            .prepare("SELECT * FROM users WHERE id=?")
            .get(user.id);
          assert.notEqual(stored.password, "test-passphrase-long");
          const session = await db
            .prepare("SELECT expires FROM sessions WHERE user_id=?")
            .get(user.id);
          assert.equal(typeof session.expires, "number");
          assert.ok(session.expires > Date.now());
          await stop();
          await start();
          const persisted = await req("/api/profile", null, token);
          assert.equal(persisted.body.name, "Persisted customer");
          assert.equal(persisted.body.monthlyDay, 12);
        },
      );
      await t.test(
        "signed financial ingestion and resolved subscription JSON on PostgreSQL",
        async () => {
          const id = randomUUID();
          await db
            .prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)")
            .run(
              id,
              user.id,
              "card",
              "connected",
              null,
              new Date().toISOString(),
            );
          const payload = JSON.stringify({
            id: randomUUID(),
            connectionId: id,
            status: "connected",
            recurring: [
              {
                id: "annual",
                merchant: "Netflix",
                amount: 199900,
                cadence: "yearly",
                nextDate: "2027-10-25",
                currency: "INR",
                status: "active",
              },
            ],
          });
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = createHmac("sha256", "test-webhook-only")
            .update(timestamp + "." + payload)
            .digest("hex");
          for (let i = 0; i < 2; i++) {
            const result = await fetch(base + "/api/webhooks/financial", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-subwise-timestamp": timestamp,
                "x-subwise-signature": signature,
              },
              body: payload,
            });
            assert.equal(result.status, 200);
          }
          const dashboard = (await req("/api/dashboard", null, token)).body;
          assert.equal(dashboard.subscriptions.length, 1);
          assert.equal(dashboard.subscriptions[0].name, "Netflix");
          assert.equal(dashboard.subscriptions[0].cadence, "yearly");
          assert.equal(
            dashboard.subscriptions[0].cancellation.available,
            false,
          );
          assert.equal(
            (await req("/api/subscriptions", { name: "Manual" }, token)).status,
            410,
          );
        },
      );
      await t.test(
        "Netlify Fetch adapter preserves cookies and API routes",
        async () => {
          Object.assign(process.env, {
            DATABASE_URL: url.href,
            NODE_ENV: "production",
            APP_ORIGIN: "https://subwise.example",
            ENABLE_TEST_PLUS: "false",
            REQUIRE_PAID_PLAN: "false",
            TRUST_PROXY: "1",
          });
          const { default: handler } =
            await import("../netlify/functions/api.mjs");
          functionDb = (await import("../server/db.js")).db;
          const health = await handler(
            new Request(
              "https://subwise.example/.netlify/functions/api/api/health",
            ),
            { ip: "127.0.0.1" },
          );
          assert.equal(health.status, 200);
          assert.deepEqual(await health.json(), { ok: true });
          const login = await handler(
            new Request("https://subwise.example/api/auth/login", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: "https://subwise.example",
              },
              body: JSON.stringify({
                email: "postgres@example.com",
                password: "test-passphrase-long",
              }),
            }),
            { ip: "127.0.0.1" },
          );
          assert.equal(login.status, 200);
          const cookie = login.headers.get("set-cookie");
          assert.match(cookie, /HttpOnly/i);
          assert.match(cookie, /Secure/i);
          assert.match(cookie, /SameSite=Strict/i);
          const profile = await handler(
            new Request("https://subwise.example/api/profile", {
              headers: { Cookie: cookie.split(";")[0] },
            }),
            { ip: "127.0.0.1" },
          );
          assert.equal(profile.status, 200);
          assert.equal((await profile.json()).name, "Persisted customer");
        },
      );
      await t.test(
        "parallel requests keep commits and rollbacks on separate clients",
        async () => {
          await db.exec(
            "CREATE TABLE IF NOT EXISTS context_probe(id TEXT PRIMARY KEY)",
          );
          let release, opened;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          const ready = new Promise((resolve) => {
            opened = resolve;
          });
          const first = db.withContext(async () => {
            await db.exec("BEGIN IMMEDIATE");
            await db
              .prepare("INSERT INTO context_probe VALUES(?)")
              .run("rolled-back");
            opened();
            await gate;
            await db.exec("ROLLBACK");
          });
          await ready;
          await db.withContext(async () => {
            await db.exec("BEGIN IMMEDIATE");
            await db
              .prepare("INSERT INTO context_probe VALUES(?)")
              .run("committed");
            await db.exec("COMMIT");
          });
          release();
          await first;
          assert.deepEqual(
            await db.prepare("SELECT id FROM context_probe").all(),
            [{ id: "committed" }],
          );
          await assert.rejects(
            db.withContext(async () => {
              await db.exec("BEGIN IMMEDIATE");
              await db
                .prepare("INSERT INTO context_probe VALUES(?)")
                .run("abandoned");
              throw Error("disconnect");
            }),
          );
          assert.equal(
            (await db.prepare("SELECT * FROM context_probe").all()).length,
            1,
          );
        },
      );
    } finally {
      await stop();
      await db.close();
      await functionDb?.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
