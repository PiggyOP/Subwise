import "dotenv/config";
import { runMonthlyEmails } from "../server/email.js";
import { db } from "../server/db.js";
try {
  const result = await runMonthlyEmails();
  console.log(
    "Monthly email sweep complete:",
    result.accepted,
    "accepted by provider",
  );
} finally {
  db.close();
}
