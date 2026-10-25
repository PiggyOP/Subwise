import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: "http://localhost:5174", headless: true },
  webServer: {
    command:
      'npx concurrently -k "node server/index.js" "vite --host 127.0.0.1 --port 5174"',
    url: "http://localhost:5174",
    env: {
      APP_ORIGIN: "http://localhost:5174",
      PORT: "3111",
      ENABLE_TEST_PLUS: "true",
      API_PORT: "3111",
      // Isolated cancellation tests cannot reach a real merchant/provider.
      CANCELLATION_CONNECTOR_URL: "https://127.0.0.1:9",
      CANCELLATION_CONNECTOR_SECRET: "browser-test-only",
      CANCELLATION_WEBHOOK_SECRET: "browser-test-signature",
      DATABASE_PATH: "data/browser-tests.sqlite",
    },
    reuseExistingServer: false,
  },
  reporter: "list",
});
