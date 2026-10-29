import { timingSafeEqual } from "node:crypto";

const jobs = new Set(["setu", "cancellations", "monthly-emails"]);

export function createHostedHandler({ loadApp, runMaintenance }) {
  return async function handler(req, res) {
    const path = new URL(req.url, "https://subwise.invalid").pathname;
    if (path.startsWith("/api/internal/maintenance/")) {
      const job = path.slice("/api/internal/maintenance/".length);
      const secret = process.env.SUBWISE_WORKER_SECRET || "";
      const expected = Buffer.from("Bearer " + secret);
      const actual = Buffer.from(req.headers.authorization || "");
      if (
        secret.length < 32 ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        res.writeHead(401, { "Cache-Control": "no-store" });
        return res.end();
      }
      if (!jobs.has(job) || req.method !== "POST") {
        res.writeHead(404, { "Cache-Control": "no-store" });
        return res.end();
      }
      await runMaintenance(job);
      res.writeHead(204, { "Cache-Control": "no-store" });
      return res.end();
    }
    const app = await loadApp();
    // Pass the original stream to Express so signed webhooks retain exact bytes.
    return app(req, res);
  };
}

export async function runHostedMaintenance(job) {
  const enabled =
    job === "setu"
      ? process.env.SETU_SANDBOX_ENABLED === "true" &&
        process.env.SETU_CLIENT_SECRET
      : job === "cancellations"
        ? process.env.CANCELLATION_CONNECTOR_URL &&
          process.env.CANCELLATION_CONNECTOR_SECRET &&
          process.env.CANCELLATION_WEBHOOK_SECRET
        : job === "monthly-emails" &&
          process.env.RESEND_API_KEY &&
          process.env.EMAIL_FROM &&
          process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!enabled) return;
  await import("./index.js");
  const { withDatabaseContext } = await import("./db.js");
  await withDatabaseContext(async () => {
    if (job === "setu") {
      const { runSetuSync } = await import("./setu.js");
      await runSetuSync({ batchSize: 1 });
    } else if (job === "cancellations") {
      const { runCancellationWorker } = await import("./cancellations.js");
      await runCancellationWorker({ batchSize: 1 });
    } else {
      const { runMonthlyEmails } = await import("./email.js");
      await runMonthlyEmails({ batchSize: 1, maxEnqueue: 10 });
    }
  });
}
