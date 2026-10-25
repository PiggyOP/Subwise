const test = require("node:test");
const assert = require("node:assert/strict");
const configure = require("../app.config.js");
const base = require("../app.json").expo;
const original = { ...process.env };
test.afterEach(() => {
  for (const k of [
    "SUBWISE_APP_VARIANT",
    "EXPO_PUBLIC_API_URL",
    "EAS_PROJECT_ID",
  ]) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});
function config(variant, api) {
  process.env.SUBWISE_APP_VARIANT = variant;
  delete process.env.EAS_PROJECT_ID;
  if (api) process.env.EXPO_PUBLIC_API_URL = api;
  else delete process.env.EXPO_PUBLIC_API_URL;
  return configure({ config: base });
}
test("development, preview and store installs have distinct identities and URL schemes", () => {
  const dev = config("development"),
    preview = config("preview", "https://api.subwise.in"),
    production = config("production", "https://api.subwise.in");
  assert.equal(dev.ios.bundleIdentifier, "in.subwise.mobile.dev");
  assert.equal(preview.android.package, "in.subwise.mobile.preview");
  assert.equal(production.ios.bundleIdentifier, "in.subwise.mobile");
  assert.equal(
    new Set([dev.scheme, preview.scheme, production.scheme]).size,
    3,
  );
  assert.equal(production.name, "Subwise");
  assert.equal(
    production.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,
    false,
  );
  assert.equal(
    production.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking,
    false,
  );
  assert.equal(
    dev.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking,
    true,
  );
  assert.equal(production.userInterfaceStyle, "automatic");
});
test("preview and store builds reject missing, insecure, local and placeholder backends", () => {
  for (const variant of ["preview", "production"])
    for (const api of [
      undefined,
      "http://api.subwise.test",
      "https://localhost",
      "https://127.0.0.1",
      "https://YOUR_BACKEND_DOMAIN",
      "https://api.example",
      "https://api.subwise.in/api",
      "https://user:password@api.subwise.test",
      "https://api.subwise.in?secret=x",
    ])
      assert.throws(() => config(variant, api));
});
test("EAS project identity comes from actual project metadata and rejects invented IDs", () => {
  config("development");
  process.env.EAS_PROJECT_ID = "not-a-project";
  assert.throws(() => configure({ config: base }));
  process.env.EAS_PROJECT_ID = "6bed086d-445a-4056-8abd-e81ce14494af";
  assert.equal(
    configure({ config: base }).extra.eas.projectId,
    process.env.EAS_PROJECT_ID,
  );
});
