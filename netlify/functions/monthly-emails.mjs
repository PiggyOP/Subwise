// No email provider means no database wake-up or delivery attempt.
import { forwardMaintenance } from "../../server/forward-maintenance.js";
export const config = { schedule: "*/5 * * * *" };
export default async function () {
  if (await forwardMaintenance("monthly-emails")) return;
  if (
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM ||
    !process.env.EMAIL_UNSUBSCRIBE_SECRET
  )
    return;
  process.env.SUBWISE_SERVERLESS = "1";
  await import("../../server/index.js");
  const { withDatabaseContext } = await import("../../server/db.js");
  const { runMonthlyEmails } = await import("../../server/email.js");
  await withDatabaseContext(() =>
    runMonthlyEmails({ batchSize: 1, maxEnqueue: 10 }),
  );
}
