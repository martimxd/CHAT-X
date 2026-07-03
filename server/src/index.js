import express from "express";
import http from "node:http";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { ensureFirstAdmin } from "./bootstrap.js";
import { ensureMediaRoot } from "./lib/media.js";
import { startCleanupJob } from "./lib/cleanup.js";
import { authRouter } from "./routes/auth.js";
import { registerRouter } from "./routes/register.js";
import { adminRouter } from "./routes/admin.js";
import { chatsRouter } from "./routes/chats.js";
import { mediaRouter } from "./routes/media.js";
import { usersRouter } from "./routes/users.js";
import { callsRouter } from "./routes/calls.js";
import { apiError } from "./lib/validators.js";
import { setupSocket } from "./socket.js";

const app = express();

if (config.trustProxy) app.set("trust proxy", 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-site" }
}));
app.use(cors({ origin: config.corsOrigin, credentials: false }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, app: config.appName });
});

app.use("/api/auth", authRouter);
app.use("/api", registerRouter);
app.use("/api/admin", adminRouter);
app.use("/api/chats", chatsRouter);
app.use("/api/media", mediaRouter);
app.use("/api/users", usersRouter);
app.use("/api/calls", callsRouter);

app.use((req, res) => apiError(res, 404, "route_not_found"));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Request failed", {
    path: req.path,
    method: req.method,
    message: error.message
  });
  return apiError(res, error.statusCode || 500, "server_error");
});

async function main() {
  await ensureMediaRoot();
  await runMigrations();
  await ensureFirstAdmin();
  startCleanupJob();

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
