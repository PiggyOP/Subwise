import {
  randomInt,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, audit } from "./db.js";
import {
  ensureProfile,
  emailConfigured,
  nextMonthlySend,
  sendEmail,
  validUnsubscribe,
  enqueueSummary,
  runMonthlyEmails,
} from "./email.js";
const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const digest = (id, email, code) =>
  createHash("sha256")
    .update(id + ":" + email + ":" + code)
    .digest("hex");
export async function readProfile(id) {
  const user = await db
      .prepare("SELECT id,name,email,created FROM users WHERE id=?")
      .get(id),
    profile = await ensureProfile(id),
    pending = await db
      .prepare(
        "SELECT email,expires FROM email_challenges WHERE user_id=? AND expires>? AND attempts<5",
      )
      .get(id, Date.now());
  return {
    ...user,
    emailVerified: profile.verified_email === user.email,
    pendingEmail: pending?.email || null,
    monthlyEnabled: !!profile.monthly_enabled,
    monthlyDay: profile.monthly_day,
    nextSendAt: profile.next_send_at,
    timeZone: "Asia/Kolkata",
    sendTime: "09:00",
    deliveryConfigured: emailConfigured(),
    lastEmail:
      (await db
        .prepare(
          "SELECT kind,status,created FROM email_outbox WHERE user_id=? ORDER BY created DESC LIMIT 1",
        )
        .get(id)) || null,
  };
}
export function registerProfileRoutes(app, { auth, verifyPassword }) {
  app.get("/api/profile", auth, async (req, res) =>
    res.json(await readProfile(req.user.id)),
  );
  app.patch("/api/profile", auth, async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        monthlyEnabled: z.boolean(),
        monthlyDay: z.number().int().min(1).max(28),
      })
      .strict()
      .parse(req.body);
    const prior = await ensureProfile(req.user.id);
    let next = prior.next_send_at;
    if (!input.monthlyEnabled) next = null;
    else if (
      !prior.monthly_enabled ||
      prior.monthly_day !== input.monthlyDay ||
      !next
    )
      next = nextMonthlySend(new Date(), input.monthlyDay);
    await db.exec("BEGIN IMMEDIATE");
    try {
      await db
        .prepare("UPDATE users SET name=? WHERE id=?")
        .run(input.name, req.user.id);
      await db
        .prepare(
          "UPDATE profiles SET monthly_enabled=?,monthly_day=?,next_send_at=? WHERE user_id=?",
        )
        .run(Number(input.monthlyEnabled), input.monthlyDay, next, req.user.id);
      if (!input.monthlyEnabled)
        await db
          .prepare(
            "UPDATE email_outbox SET status='cancelled' WHERE user_id=? AND kind='monthly' AND status='queued'",
          )
          .run(req.user.id);
      await audit(req.user.id, "profile.updated");
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
    res.json(await readProfile(req.user.id));
  });
  app.post(
    "/api/profile/email/request",
    auth,
    rateLimit({
      windowMs: 600000,
      limit: 6,
    }),
    async (req, res) => {
      const input = z
        .object({
          email: emailSchema,
          currentPassword: z.string().max(128).optional(),
        })
        .strict()
        .parse(req.body);
      if (!emailConfigured())
        return res.status(503).json({
          error:
            "Email delivery is not configured. Your email remains saved; verification can start after the operator connects an email provider.",
        });
      if (
        input.email !== req.user.email &&
        (!input.currentPassword ||
          !(await verifyPassword(input.currentPassword, req.user.password)))
      )
        return res.status(401).json({
          error: "Enter your current password to change the account email.",
        });
      const taken = await db
        .prepare("SELECT id FROM users WHERE email=? AND id<>?")
        .get(input.email, req.user.id);
      if (taken)
        return res.status(409).json({
          error: "That email cannot be linked to this account.",
        });
      const previous = await db
        .prepare("SELECT expires FROM email_challenges WHERE user_id=?")
        .get(req.user.id);
      if (previous && previous.expires > Date.now() + 9 * 60000)
        return res.status(429).json({
          error: "Please wait one minute before requesting another code.",
        });
      const id = randomUUID(),
        code = String(randomInt(100000, 1000000));
      await db
        .prepare(
          "INSERT INTO email_challenges VALUES(?,?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,email=excluded.email,code_hash=excluded.code_hash,expires=excluded.expires,attempts=0",
        )
        .run(
          req.user.id,
          id,
          input.email,
          digest(id, input.email, code),
          Date.now() + 600000,
        );
      try {
        await sendEmail(
          {
            from: process.env.EMAIL_FROM,
            to: [input.email],
            subject: "Verify your Subwise email",
            text: `Your Subwise verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
          },
          "subwise/verify/" + id,
        );
      } catch {
        await db
          .prepare("DELETE FROM email_challenges WHERE user_id=? AND id=?")
          .run(req.user.id, id);
        return res.status(502).json({
          error:
            "The email provider could not accept the verification email. Please try again later.",
        });
      }
      res.json({
        ok: true,
        message:
          "Verification email accepted by the provider. Enter the code from your inbox.",
      });
    },
  );
  app.post(
    "/api/profile/email/verify",
    auth,
    rateLimit({
      windowMs: 600000,
      limit: 20,
    }),
    async (req, res) => {
      const { code } = z
        .object({
          code: z.string().regex(/^\d{6}$/),
        })
        .strict()
        .parse(req.body);
      const challenge = await db
        .prepare("SELECT * FROM email_challenges WHERE user_id=?")
        .get(req.user.id);
      if (
        !challenge ||
        challenge.expires <= Date.now() ||
        challenge.attempts >= 5
      )
        return res.status(400).json({
          error:
            "The verification code expired or was locked. Request a new code.",
        });
      await db
        .prepare(
          "UPDATE email_challenges SET attempts=attempts+1 WHERE user_id=?",
        )
        .run(req.user.id);
      const expected = digest(challenge.id, challenge.email, code);
      if (
        !timingSafeEqual(
          Buffer.from(expected),
          Buffer.from(challenge.code_hash),
        )
      )
        return res.status(400).json({
          error: "Incorrect verification code.",
        });
      if (
        await db
          .prepare("SELECT id FROM users WHERE email=? AND id<>?")
          .get(challenge.email, req.user.id)
      )
        return res.status(409).json({
          error: "That email cannot be linked to this account.",
        });
      const profile = await ensureProfile(req.user.id);
      await db.exec("BEGIN IMMEDIATE");
      try {
        await db
          .prepare("UPDATE users SET email=? WHERE id=?")
          .run(challenge.email, req.user.id);
        await db
          .prepare(
            "UPDATE profiles SET verified_email=?,verified_at=?,next_send_at=? WHERE user_id=?",
          )
          .run(
            challenge.email,
            new Date().toISOString(),
            profile.monthly_enabled
              ? nextMonthlySend(new Date(), profile.monthly_day)
              : null,
            req.user.id,
          );
        await db
          .prepare("DELETE FROM email_challenges WHERE user_id=?")
          .run(req.user.id);
        await db
          .prepare(
            "UPDATE email_outbox SET status='cancelled' WHERE user_id=? AND status='queued' AND recipient<>?",
          )
          .run(req.user.id, challenge.email);
        await audit(req.user.id, "email.verified");
        await db.exec("COMMIT");
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
      res.json(await readProfile(req.user.id));
    },
  );
  app.post(
    "/api/profile/email/test",
    auth,
    rateLimit({
      windowMs: 600000,
      limit: 3,
    }),
    async (req, res) => {
      if (!emailConfigured())
        return res.status(503).json({
          error: "Email delivery is not configured.",
        });
      const profile = await ensureProfile(req.user.id);
      if (profile.verified_email !== req.user.email)
        return res.status(409).json({
          error: "Verify your email first.",
        });
      const id = await enqueueSummary(req.user, "test");
      await runMonthlyEmails();
      const job = await db
        .prepare("SELECT status FROM email_outbox WHERE id=?")
        .get(id);
      res.json({
        status: job.status,
        message:
          job.status === "accepted"
            ? "Test summary accepted by the email provider."
            : "Test summary queued for delivery.",
      });
    },
  );
  const parseUnsubscribe = async (req) => {
    const id = req.query.id || req.body?.id,
      token = req.query.token || req.body?.token;
    const user =
      typeof id === "string" &&
      (await db.prepare("SELECT id,email FROM users WHERE id=?").get(id));
    return user && validUnsubscribe(user, token) ? user : null;
  };
  app.get("/api/email/unsubscribe", async (req, res) => {
    const user = await parseUnsubscribe(req);
    if (!user)
      return res
        .status(400)
        .send(
          "This unsubscribe link is invalid or no longer current. Manage email preferences in Subwise.",
        );
    res
      .type("html")
      .send(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subwise email preferences</title></head><body style="font-family:Arial;max-width:480px;margin:80px auto;padding:24px;color:#263c32"><h1>Stop monthly emails?</h1><p>Your Subwise account and subscriptions will stay active.</p><form method="post"><button style="padding:12px;background:#174b3a;color:white;border:0;border-radius:5px">Unsubscribe from monthly summaries</button></form></body></html>',
      );
  });
  app.post(
    "/api/email/unsubscribe",
    express.urlencoded({
      extended: false,
      limit: "2kb",
    }),
    async (req, res) => {
      const user = await parseUnsubscribe(req);
      if (!user) return res.status(400).send("Invalid unsubscribe link.");
      await ensureProfile(user.id);
      await db
        .prepare(
          "UPDATE profiles SET monthly_enabled=0,next_send_at=NULL WHERE user_id=?",
        )
        .run(user.id);
      await db
        .prepare(
          "UPDATE email_outbox SET status='cancelled' WHERE user_id=? AND kind='monthly' AND status='queued'",
        )
        .run(user.id);
      await audit(user.id, "email.unsubscribed");
      res
        .type("html")
        .send(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed · Subwise</title></head><body style="font-family:Arial;max-width:480px;margin:80px auto;padding:24px"><h1>You are unsubscribed.</h1><p>Monthly summaries are off. You can change this in your Subwise profile.</p></body></html>',
        );
    },
  );
}
