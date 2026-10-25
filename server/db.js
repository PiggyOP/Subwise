import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
mkdirSync("data", { recursive: true });
export const db = new DatabaseSync(
  process.env.DATABASE_PATH || "data/subwise.sqlite",
);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),cadence TEXT NOT NULL,next_date TEXT NOT NULL,category TEXT NOT NULL,payment TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',source TEXT NOT NULL DEFAULT 'unverified',merchant_key TEXT,confidence REAL,created TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_merchant ON subscriptions(user_id,merchant_key) WHERE merchant_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,merchant TEXT NOT NULL,amount INTEGER NOT NULL,date TEXT NOT NULL,UNIQUE(user_id,merchant,amount,date));
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,action TEXT NOT NULL,subject TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS billing(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,provider_id TEXT UNIQUE,status TEXT NOT NULL,period_end INTEGER);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,created TEXT NOT NULL);
`);
export function audit(userId, action, subject) {
  db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
    crypto.randomUUID(),
    userId,
    action,
    subject || null,
    new Date().toISOString(),
  );
}
export function subscriptions(userId) {
  return db
    .prepare(
      "SELECT * FROM subscriptions WHERE user_id=? AND source IN ('card','upi') ORDER BY next_date",
    )
    .all(userId);
}

if (
  !db
    .prepare("PRAGMA table_info(billing)")
    .all()
    .some((x) => x.name === "last_event")
)
  db.exec(
    "ALTER TABLE billing ADD COLUMN last_event INTEGER NOT NULL DEFAULT 0",
  );
