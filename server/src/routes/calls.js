import express from "express";
import { config } from "../config.js";
import { requireAuth } from "../lib/auth.js";
import { asyncHandler } from "../lib/http.js";

export const callsRouter = express.Router();

callsRouter.use(requireAuth());

callsRouter.get(
  "/config",
  asyncHandler(async (req, res) => {
    const iceServers = [];
    if (config.stunUrls.length > 0) iceServers.push({ urls: config.stunUrls });
    if (config.turnUrls.length > 0) {
      iceServers.push({
        urls: config.turnUrls,
        username: config.turnUsername || undefined,
        credential: config.turnCredential || undefined
      });
    }
    return res.json({ iceServers });
  })
);
