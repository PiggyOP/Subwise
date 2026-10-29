import {
  createHostedHandler,
  runHostedMaintenance,
} from "../server/hosted-handler.js";

process.env.SUBWISE_SERVERLESS = "1";
let startup;

export default createHostedHandler({
  loadApp: () =>
    (startup ??= import("../server/index.js").then(({ app }) => app)),
  runMaintenance: runHostedMaintenance,
});
