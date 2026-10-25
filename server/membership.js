import { db, audit, withDatabaseContext } from "./db.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

await db.exec(`CREATE TABLE IF NOT EXISTS complimentary_plus(
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 source TEXT NOT NULL, created TEXT NOT NULL);`);

export async function complimentaryPlus(userId) {
  return !!(await db
    .prepare("SELECT user_id FROM complimentary_plus WHERE user_id=?")
    .get(userId));
}
export async function membershipStatus(userId) {
  if (await complimentaryPlus(userId))
    return { status: "active", complimentary: true, period_end: null };
  return (
    (await db
      .prepare("SELECT status,period_end FROM billing WHERE user_id=?")
      .get(userId)) || { status: "unsubscribed" }
  );
}

// Operator-only configuration provisions the specifically authorized test user.
// No public grant endpoint or browser-supplied entitlement is accepted.
const email = process.env.PLUS_TEST_EMAIL;
const passwordHash = process.env.PLUS_TEST_PASSWORD_HASH;
if (email || passwordHash) {
  const normalized = z.email().parse(email).toLowerCase();
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash || ""))
    throw Error("Invalid test account configuration");
  await withDatabaseContext(async () => {
    await db.exec("BEGIN IMMEDIATE");
    try {
      await db
        .prepare(
          "INSERT OR IGNORE INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          normalized,
          "Subwise tester",
          passwordHash,
          new Date().toISOString(),
        );
      const user = await db
        .prepare("SELECT id,password FROM users WHERE email=?")
        .get(normalized);
      // A requested credential change invalidates existing sessions, once.
      if (user.password !== passwordHash) {
        await db
          .prepare("UPDATE users SET password=? WHERE id=?")
          .run(passwordHash, user.id);
        await db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      }
      const existing = await complimentaryPlus(user.id);
      await db
        .prepare("INSERT OR IGNORE INTO complimentary_plus VALUES(?,?,?)")
        .run(user.id, "operator_test", new Date().toISOString());
      if (!existing) await audit(user.id, "membership.complimentary_granted");
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}
