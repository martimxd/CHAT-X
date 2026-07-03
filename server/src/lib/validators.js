import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/);

export const passwordSchema = z
  .string()
  .min(10)
  .max(256)
  .refine((value) => /[a-z]/.test(value), "lowercase")
  .refine((value) => /[A-Z]/.test(value), "uppercase")
  .refine((value) => /\d/.test(value), "number")
  .refine((value) => /[^A-Za-z0-9]/.test(value), "symbol");

export const languageSchema = z.enum(["en", "pt", "fr"]);

export function validateUsername(username) {
  return usernameSchema.safeParse(username).success;
}

export function validatePassword(password) {
  return passwordSchema.safeParse(password).success;
}

export function apiError(res, status, code, details = undefined) {
  return res.status(status).json({ error: { code, details } });
}

export function parseBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "validation_failed", parsed.error.flatten());
    }
    req.validatedBody = parsed.data;
    return next();
  };
}
