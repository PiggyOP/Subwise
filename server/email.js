import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { db, subscriptions, audit } from "./db.js";

db.exec(`CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,verified_email TEXT,verified_at TEXT,monthly_enabled INTEGER NOT NULL DEFAULT 0,monthly_day INTEGER NOT NULL DEFAULT 1,next_send_at TEXT);
CREATE TABLE IF NOT EXISTS email_challenges(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,id TEXT NOT NULL,email TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS email_outbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,period TEXT NOT NULL,recipient TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,started_at INTEGER,provider_id TEXT,created TEXT NOT NULL,UNIQUE(user_id,kind,period));`);
export function emailConfigured() {
  return !!(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.EMAIL_UNSUBSCRIBE_SECRET
  );
}
export function ensureProfile(id) {
  db.prepare("INSERT OR IGNORE INTO profiles(user_id) VALUES(?)").run(id);
  return db.prepare("SELECT * FROM profiles WHERE user_id=?").get(id);
}
function localParts(now) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .filter((x) => ["year", "month", "day"].includes(x.type))
      .map((x) => [x.type, Number(x.value)]),
  );
}
export function nextMonthlySend(now = new Date(), day = 1) {
  const { year, month } = localParts(now);
  let next = new Date(Date.UTC(year, month - 1, day, 3, 30));
  if (next <= now) next = new Date(Date.UTC(year, month, day, 3, 30));
  return next.toISOString();
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n / 100);
export function unsubscribeToken(user) {
  return createHmac("sha256", process.env.EMAIL_UNSUBSCRIBE_SECRET)
    .update(user.id + ":" + user.email)
    .digest("hex");
}
export function validUnsubscribe(user, token) {
  if (!process.env.EMAIL_UNSUBSCRIBE_SECRET || typeof token !== "string")
    return false;
  const expected = unsubscribeToken(user);
  return (
    token.length === expected.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  );
}
export function summaryEmail(user, now = new Date()) {
  const rows = subscriptions(user.id).filter((s) =>
    ["active", "cancellation_requested"].includes(s.status),
  );
  const total = rows.reduce(
    (sum, s) =>
      sum +
      s.amount *
        (s.cadence === "yearly"
          ? 1 / 12
          : s.cadence === "weekly"
            ? 52 / 12
            : 1),
    0,
  );
  const label = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(now);
  const url =
    (process.env.APP_ORIGIN || "http://localhost:5173") +
    "/api/email/unsubscribe?id=" +
    encodeURIComponent(user.id) +
    "&token=" +
    unsubscribeToken(user);
  return {
    from: process.env.EMAIL_FROM,
    to: [user.email],
    subject: `Your Subwise subscription check-in · ${label}`,
    text: `Hi ${user.name},\n\nHere is your current subscription snapshot for ${label}.\n${rows.length} active subscriptions · ${money(total)} monthly equivalent · ${money(total * 12)} projected yearly.\n\n${rows.map((s) => `${s.name}: ${money(s.amount)} / ${s.cadence}; next recorded payment ${s.next_date}`).join("\n") || "No active subscriptions are recorded."}\n\nThese are tracked commitments, not a bank statement or proof of payment.\nManage your account: ${process.env.APP_ORIGIN || "http://localhost:5173"}\nStop monthly emails: ${url}`,
    html: `<div style="font-family:Arial,sans-serif;color:#263c32;max-width:600px;margin:auto;padding:28px"><p style="color:#174b3a;font-weight:700">subwise.</p><h1 style="font-family:Georgia,serif;font-weight:400">A little clarity for ${escape(label)}.</h1><p>Hi ${escape(user.name)}, here is your current subscription snapshot.</p><p><b>${rows.length} active subscriptions</b><br>${money(total)} monthly equivalent · ${money(total * 12)} projected yearly</p><table style="width:100%;border-collapse:collapse">${rows.map((s) => `<tr><td style="padding:12px 0;border-bottom:1px solid #dde4d8">${escape(s.name)}<br><small>Next recorded payment: ${escape(s.next_date)}</small></td><td style="text-align:right;border-bottom:1px solid #dde4d8">${money(s.amount)} / ${escape(s.cadence)}</td></tr>`).join("") || "<tr><td>No active subscriptions are recorded.</td></tr>"}</table><p style="font-size:12px;color:#68766e">These are tracked commitments, not a bank statement or proof of payment.</p><p><a href="${escape(process.env.APP_ORIGIN || "http://localhost:5173")}">Open Subwise</a> · <a href="${escape(url)}">Stop monthly emails</a></p></div>`,
    headers: {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
export async function sendEmail(payload, idempotencyKey) {
  if (!emailConfigured()) throw Error("Email delivery is not configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("Email provider rejected the request");
  const result = await r.json();
  if (!result.id) throw Error("Email provider did not confirm acceptance");
  return result.id;
}
export function enqueueSummary(user, kind = "monthly", now = new Date()) {
  const { year, month } = localParts(now),
    period =
      kind === "monthly"
        ? `${year}-${String(month).padStart(2, "0")}`
        : randomUUID(),
    id = randomUUID();
  const payload = summaryEmail(user, now);
  db.prepare(
    "INSERT OR IGNORE INTO email_outbox(id,user_id,kind,period,recipient,payload,next_attempt,created) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    id,
    user.id,
    kind,
    period,
    user.email,
    JSON.stringify(payload),
    now.getTime(),
    now.toISOString(),
  );
  return id;
}
let running = false;
export async function runMonthlyEmails({
  now = new Date(),
  mailer = sendEmail,
  configured = emailConfigured(),
} = {}) {
  if (running || !configured) return { accepted: 0 };
  running = true;
  let accepted = 0;
  try {
    const due = db
      .prepare(
        "SELECT users.* ,profiles.monthly_day FROM users JOIN profiles ON users.id=profiles.user_id WHERE profiles.monthly_enabled=1 AND profiles.verified_email=users.email AND profiles.next_send_at<=?",
      )
      .all(now.toISOString());
    for (const user of due) {
      db.exec("BEGIN IMMEDIATE");
      try {
        enqueueSummary(user, "monthly", now);
        db.prepare("UPDATE profiles SET next_send_at=? WHERE user_id=?").run(
          nextMonthlySend(now, user.monthly_day),
          user.id,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    db.prepare(
      "UPDATE email_outbox SET status='queued' WHERE status='sending' AND started_at<? AND started_at>?",
    ).run(now.getTime() - 60000, now.getTime() - 22 * 3600000);
    db.prepare(
      "UPDATE email_outbox SET status='unknown' WHERE status IN ('queued','sending') AND started_at IS NOT NULL AND started_at<?",
    ).run(now.getTime() - 22 * 3600000);
    const queue = db
      .prepare(
        "SELECT * FROM email_outbox WHERE status='queued' AND next_attempt<=? ORDER BY next_attempt LIMIT 25",
      )
      .all(now.getTime());
    for (const job of queue) {
      const user = db
        .prepare(
          "SELECT users.*,profiles.verified_email,profiles.monthly_enabled FROM users JOIN profiles ON users.id=profiles.user_id WHERE users.id=?",
        )
        .get(job.user_id);
      if (
        !user ||
        user.verified_email !== job.recipient ||
        user.email !== job.recipient ||
        (job.kind === "monthly" && !user.monthly_enabled)
      ) {
        db.prepare("UPDATE email_outbox SET status='cancelled' WHERE id=?").run(
          job.id,
        );
        continue;
      }
      const claim = db
        .prepare(
          "UPDATE email_outbox SET status='sending',attempts=attempts+1,started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'",
        )
        .run(now.getTime(), job.id);
      if (!claim.changes) continue;
      try {
        const providerId = await mailer(
          JSON.parse(job.payload),
          "subwise/" + job.id,
        );
        db.prepare(
          "UPDATE email_outbox SET status='accepted',provider_id=? WHERE id=?",
        ).run(providerId, job.id);
        audit(user.id, "email.provider_accepted", job.kind);
        accepted++;
      } catch {
        const attempts = job.attempts + 1;
        db.prepare(
          "UPDATE email_outbox SET status=?,next_attempt=? WHERE id=?",
        ).run(
          attempts >= 5 ? "failed" : "queued",
          now.getTime() + 60000 * 2 ** attempts,
          job.id,
        );
      }
    }
    return { accepted };
  } finally {
    running = false;
  }
}
export function startEmailWorker() {
  const tick = () =>
    runMonthlyEmails().catch(() =>
      console.error("Monthly email worker failed"),
    );
  const timer = setInterval(tick, 60000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
