import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import { decryptFromStorage, encryptForStorage, signMediaUrl } from "../lib/crypto.js";
import { asyncHandler } from "../lib/http.js";
import { ensureMediaRoot, storagePathFor, userCanAccessMedia } from "../lib/media.js";
import { requireAuth } from "../lib/auth.js";
import { apiError } from "../lib/validators.js";
import { permissionAllows } from "../lib/social.js";

export const mediaRouter = express.Router();
const execFileAsync = promisify(execFile);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes }
});
const avatarMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

async function compressVideo(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chatx-video-"));
  const input = path.join(dir, "input");
  const output = path.join(dir, "output.mp4");
  try {
    await fs.writeFile(input, buffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-vcodec",
      "libx264",
      "-crf",
      String(config.videoCompressionCrf),
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-acodec",
      "aac",
      output
    ]);
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

mediaRouter.use(requireAuth());

mediaRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return apiError(res, 400, "file_required");

    const parsed = z.object({
      chatId: z.string().uuid().optional(),
      purpose: z.enum(["message", "avatar", "group_avatar"]).default("message"),
      encryptedBlob: z.preprocess((value) => {
        if (value === undefined) return true;
        if (value === "true" || value === true) return true;
        if (value === "false" || value === false) return false;
        return value;
      }, z.boolean()).default(true),
      metadata: z.string().optional()
    }).safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "validation_failed", parsed.error.flatten());

    let { chatId, purpose, encryptedBlob } = parsed.data;
    let metadata = {};
    if (parsed.data.metadata) {
      try {
        metadata = JSON.parse(parsed.data.metadata);
      } catch {
        return apiError(res, 400, "invalid_metadata");
      }
    }

    if (purpose === "message") {
      if (!chatId) return apiError(res, 400, "chat_required");
      const member = await query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND deleted_at IS NULL", [chatId, req.user.id]);
      if (member.rowCount === 0) return apiError(res, 403, "chat_access_denied");
      if (!encryptedBlob && !config.allowTrustedMediaProcessing) return apiError(res, 400, "message_media_must_be_client_encrypted");
    }
    if (purpose === "group_avatar") {
      if (!chatId) return apiError(res, 400, "chat_required");
      const member = await query(
        `SELECT c.change_image_permission, cm.role
         FROM chats c
         JOIN chat_members cm ON cm.chat_id = c.id
         WHERE c.id = $1 AND c.type = 'group' AND cm.user_id = $2 AND cm.deleted_at IS NULL AND c.archived_at IS NULL`,
        [chatId, req.user.id]
      );
      if (member.rowCount === 0) return apiError(res, 403, "chat_access_denied");
      if (!permissionAllows(member.rows[0].change_image_permission, member.rows[0].role)) {
        return apiError(res, 403, "group_permission_denied");
      }
    }
    if (purpose === "avatar" || purpose === "group_avatar") {
      if (!avatarMimeTypes.has(req.file.mimetype)) return apiError(res, 400, "unsupported_avatar_type");
      encryptedBlob = false;
    }

    let payload = req.file.buffer;
    let mimeType = req.file.mimetype || "application/octet-stream";
    if ((purpose === "avatar" || purpose === "group_avatar" || !encryptedBlob) && mimeType.startsWith("image/")) {
      payload = await sharp(payload).rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
      mimeType = "image/webp";
      metadata = { ...metadata, serverCompressed: true };
    }
    if (!encryptedBlob && mimeType.startsWith("video/")) {
      payload = await compressVideo(payload);
      mimeType = "video/mp4";
      metadata = { ...metadata, serverCompressed: true, videoCrf: config.videoCompressionCrf };
    }

    await ensureMediaRoot();
    const inserted = await query(
      `INSERT INTO media_files (
         uploader_id,
         chat_id,
         storage_path,
         original_name,
         mime_type,
         byte_size,
         encrypted_blob,
         server_encryption,
         metadata,
         purpose
       )
       VALUES ($1, $2, '', $3, $4, $5, $6, '{}', $7, $8)
       RETURNING id`,
      [req.user.id, chatId || null, req.file.originalname || "upload.bin", mimeType, payload.length, encryptedBlob, metadata, purpose]
    );

    const mediaId = inserted.rows[0].id;
    const encrypted = encryptForStorage(payload);
    const filePath = storagePathFor(mediaId);
    await fs.writeFile(filePath, encrypted.ciphertext, { flag: "wx" });
    const result = await query(
      `UPDATE media_files
       SET storage_path = $1,
           server_encryption = $2
       WHERE id = $3
       RETURNING *`,
      [filePath, encrypted.envelope, mediaId]
    );

    if (purpose === "avatar") {
      await query("UPDATE users SET avatar_media_id = $1, updated_at = now() WHERE id = $2", [mediaId, req.user.id]);
    }
    if (purpose === "group_avatar") {
      await query("UPDATE chats SET avatar_media_id = $1, updated_at = now() WHERE id = $2", [mediaId, chatId]);
      req.app.get("io")?.to(`chat:${chatId}`).emit("chat:updated", { chatId });
    }

    return res.status(201).json({
      media: {
        id: result.rows[0].id,
        mimeType: result.rows[0].mime_type,
        byteSize: Number(result.rows[0].byte_size),
        originalName: result.rows[0].original_name,
        encryptedBlob: result.rows[0].encrypted_blob,
        metadata: result.rows[0].metadata,
        purpose: result.rows[0].purpose,
        createdAt: result.rows[0].created_at
      }
    });
  })
);

mediaRouter.get(
  "/:id/link",
  asyncHandler(async (req, res) => {
    const allowed = await userCanAccessMedia(req.user.id, req.params.id);
    if (!allowed) return apiError(res, 404, "media_not_found");
    const expiresAt = Math.floor(Date.now() / 1000) + config.signedMediaUrlTtlSeconds;
    const signature = signMediaUrl({ mediaId: req.params.id, userId: req.user.id, expiresAt });
    return res.json({
      url: `/api/media/${req.params.id}/download?expiresAt=${expiresAt}&signature=${encodeURIComponent(signature)}`,
      expiresAt
    });
  })
);

mediaRouter.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    const expiresAt = Number(req.query.expiresAt);
    const signature = String(req.query.signature || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      return apiError(res, 410, "media_url_expired");
    }
    const expected = signMediaUrl({ mediaId: req.params.id, userId: req.user.id, expiresAt });
    if (signature !== expected) return apiError(res, 403, "media_signature_invalid");

    const allowed = await userCanAccessMedia(req.user.id, req.params.id);
    if (!allowed) return apiError(res, 404, "media_not_found");
    const result = await query("SELECT * FROM media_files WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (result.rowCount === 0) return apiError(res, 404, "media_not_found");

    const media = result.rows[0];
    const ciphertext = await fs.readFile(media.storage_path);
    const payload = decryptFromStorage(ciphertext, media.server_encryption);
    res.setHeader("Content-Type", media.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(media.original_name)}"`);
    return res.send(payload);
  })
);
