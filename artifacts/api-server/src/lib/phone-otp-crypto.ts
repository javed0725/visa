import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export const OTP_TTL = 120_000;
export const PAIR_TTL = 10 * 60_000;
export const SESSION_TTL = 24 * 60 * 60_000;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function clientKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Exactly 32 symbols: masking is unbiased.
  const value = [...randomBytes(8)].map(byte => alphabet[byte & 31]).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}
function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for OTP encryption");
  return createHash("sha256").update(`phone-otp:${secret}`).digest();
}
export function encryptOTP(otp: string, pairingId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(pairingId));
  const data = Buffer.concat([cipher.update(otp, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(value => value.toString("base64url")).join(".");
}
export function decryptOTP(value: string, pairingId: string) {
  const [iv, tag, data] = value.split(".").map(value => Buffer.from(value, "base64url"));
  if (!iv || !tag || !data) throw new Error("Invalid encrypted OTP");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(pairingId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
