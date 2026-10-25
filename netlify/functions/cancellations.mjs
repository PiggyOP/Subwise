// Leave the database asleep while no cancellation provider is configured.
export const config = { schedule: "*/5 * * * *" };
export default async function () {
  if (
    !process.env.CANCELLATION_CONNECTOR_URL ||
    !process.env.CANCELLATION_CONNECTOR_SECRET ||
    !process.env.CANCELLATION_WEBHOOK_SECRET
  )
    return;
  process.env.SUBWISE_SERVERLESS = "1";
  await import("../../server/index.js");
  const { withDatabaseContext } = await import("../../server/db.js");
  const { runCancellationWorker } =
    await import("../../server/cancellations.js");
  await withDatabaseContext(() => runCancellationWorker({ batchSize: 1 }));
}
