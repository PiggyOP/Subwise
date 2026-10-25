import serverless from "serverless-http";
process.env.SUBWISE_SERVERLESS = "1";
const { app } = await import("../../server/index.js");
const serve = serverless(app);

// Netlify's native ESM runtime supports the asynchronous PostgreSQL startup.
// Adapt its Fetch request to Express without changing raw webhook bytes.
export default async function handler(request, context) {
  const url = new URL(request.url);
  const prefix = "/.netlify/functions/api";
  const path = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length) || "/"
    : url.pathname;
  const headers = Object.fromEntries(request.headers);
  if (context.ip) headers["x-forwarded-for"] = context.ip;
  const query = {};
  for (const key of new Set(url.searchParams.keys()))
    query[key] = url.searchParams.getAll(key);
  const response = await serve(
    {
      httpMethod: request.method,
      path,
      headers,
      multiValueQueryStringParameters: query,
      body: Buffer.from(await request.arrayBuffer()).toString("base64"),
      isBase64Encoded: true,
      requestContext: { identity: { sourceIp: context.ip } },
    },
    { callbackWaitsForEmptyEventLoop: false },
  );
  const outputHeaders = new Headers(response.headers);
  for (const [key, values] of Object.entries(
    response.multiValueHeaders || {},
  )) {
    outputHeaders.delete(key);
    for (const value of values) outputHeaders.append(key, value);
  }
  const body = response.body
    ? Buffer.from(response.body, response.isBase64Encoded ? "base64" : "utf8")
    : null;
  return new Response([204, 304].includes(response.statusCode) ? null : body, {
    status: response.statusCode,
    headers: outputHeaders,
  });
}
