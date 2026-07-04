import http from "node:http";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { runMigrations } from "./migrate.js";
import { ensureFirstAdmin } from "./bootstrap.js";
import { ensureMediaRoot } from "./lib/media.js";
import { startCleanupJob } from "./lib/cleanup.js";
import { setupSocket } from "./socket.js";

async function main() {
  await ensureMediaRoot();
  await runMigrations();
  await ensureFirstAdmin();
  startCleanupJob();

  const app = createApp();
  const server = http.createServer(app);
  const io = setupSocket(server);
  app.set("io", io);

  server.listen(config.port, () => {
    console.info(`${config.appName} API listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error("Server startup failed", { message: error.message });
  process.exit(1);
});
