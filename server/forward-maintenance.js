export async function forwardMaintenance(job) {
  const configured = process.env.SUBWISE_WORKER_ORIGIN;
  if (!configured) return false;
  const origin = new URL(configured);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !origin.hostname.endsWith(".vercel.app") ||
    (process.env.SUBWISE_WORKER_SECRET || "").length < 32
  )
    throw Error("Invalid worker destination configuration");
  const response = await fetch(
    new URL("/api/internal/maintenance/" + job, origin),
    {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.SUBWISE_WORKER_SECRET },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    },
  );
  if (response.status !== 204)
    throw Error("Hosted maintenance failed: HTTP " + response.status);
  return true;
}
