export const config = { schedule: "*/5 * * * *" };
export default async function () {
  if (
    process.env.SETU_SANDBOX_ENABLED !== "true" ||
    !process.env.SETU_CLIENT_SECRET
  )
    return;
  process.env.SUBWISE_SERVERLESS = "1";
  await import("../../server/index.js");
  const { withDatabaseContext } = await import("../../server/db.js");
  const { runSetuSync } = await import("../../server/setu.js");
  await withDatabaseContext(() => runSetuSync({ batchSize: 1 }));
}
