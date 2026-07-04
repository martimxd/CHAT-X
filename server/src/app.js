import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { registerRouter } from "./routes/register.js";
import { adminRouter } from "./routes/admin.js";
import { chatsRouter } from "./routes/chats.js";
import { mediaRouter } from "./routes/media.js";
import { usersRouter } from "./routes/users.js";
import { callsRouter } from "./routes/calls.js";
import { apiError } from "./lib/validators.js";
import {
  describeOriginPolicy,
  getRequestPublicOrigin,
  isRequestOriginAllowed,
  shouldValidateOrigin
} from "./lib/origin.js";

function corsOptions(req, callback) {
  const origin = req.header("origin");
  const allowed = isRequestOriginAllowed(req, origin);
  if (origin && !allowed) {
    console.warn("CORS origin rejected", {
      origin,
      method: req.method,
      path: req.originalUrl,
      requestOrigin: getRequestPublicOrigin(req),
      policy: describeOriginPolicy()
    });
  }
  callback(null, {
    origin: origin && allowed ? origin : false,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
    maxAge: 86400
  });
}

function originGuard(req, res, next) {
  if (!shouldValidateOrigin(req)) return next();
  const origin = req.header("origin");
  if (!origin || isRequestOriginAllowed(req, origin)) return next();
  console.warn("Request origin rejected", {
    origin,
    method: req.method,
    path: req.originalUrl,
    requestOrigin: getRequestPublicOrigin(req),
    policy: describeOriginPolicy()
  });
  return apiError(res, 403, "origin_not_allowed");
}

async function health(req, res) {
  let database = { ok: false };
  try {
    await pool.query("SELECT 1");
    database = { ok: true };
  } catch (error) {
    console.error("Healthcheck database probe failed", { message: error.message });
    database = { ok: false, error: "database_unavailable" };
  }

  const ok = database.ok;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    app: config.appName,
    version: config.version,
    database,
    publicUrl: getRequestPublicOrigin(req),
    websocket: {
      available: true,
      path: "/socket.io"
    }
  });
}

export function createApp() {
  const app = express();

  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-site" }
  }));
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(originGuard);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", health);
  app.get("/api/health", health);

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
      origin: req.header("origin") || null,
      host: req.header("host") || null,
      forwardedHost: req.header("x-forwarded-host") || null,
      forwardedProto: req.header("x-forwarded-proto") || null,
      message: error.message
    });
    return apiError(res, error.statusCode || 500, "server_error");
  });

  return app;
}
