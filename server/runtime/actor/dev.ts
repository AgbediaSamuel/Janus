import { fileURLToPath } from "node:url";
import { startLocalActors } from "terse-sdk/dev";

const project = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = await startLocalActors({
  project,
  entrypoint: "server/runtime/actor/src/actor.ts",
  projectId: "janus",
  dataDir: process.env.TERSE_DATA_DIR ?? ".durable-actors",
  port: Number(process.env.TERSE_PORT ?? "7100"),
});
console.log(`Terse local actor server: ${runtime.connection.controlPlaneUrl}`);
console.log(`Project: ${runtime.connection.projectId}`);
process.once("SIGINT", () => {
  void runtime.stop();
});
process.once("SIGTERM", () => {
  void runtime.stop();
});
await runtime.closed;
