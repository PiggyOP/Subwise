import "dotenv/config";
import { runMonthlyEmails } from "../server/email.js";
import { db, withDatabaseContext } from "../server/db.js";
try {
  const result = await withDatabaseContext(() => runMonthlyEmails());
  console.log(
    "Monthly email sweep complete:",
    result.accepted,
    "accepted by provider",
  );
} finally {
  await db.close();
}
