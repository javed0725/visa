import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { PairPhoneBody, UpdatePhonePairingBody, SendPhoneOTPBody } from "@workspace/api-zod";
import { clientKey, token, digest, encryptOTP, decryptOTP, OTP_TTL, PAIR_TTL, SESSION_TTL } from "../lib/phone-otp-crypto";

const router = Router();
type Pairing = {
  id: string; device_hash: string | null; enabled: boolean;
  pair_expires_at: string; expires_at: string; key_hash: string;
  otp_cipher: string | null; message_id: string | null; received_at: string | null;
};
class RelayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const windows = new Map<string, { until: number; count: number }>();
function limit(key: string, max: number, duration = 60_000) {
  const now = Date.now();
  const existing = windows.get(key);
  if (existing && existing.until > now) {
    if (++existing.count > max) throw new RelayError(429, "Too many requests. Wait and try again.");
  } else {
    if (windows.size >= 10_000) {
      for (const [key, value] of windows) if (value.until <= now) windows.delete(key);
      if (windows.size >= 10_000) throw new RelayError(503, "Relay busy. Try again shortly.");
    }
    windows.set(key, { until: now + duration, count: 1 });
  }
}
const route = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
function bearer(req: Request) {
  const value = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!value) throw new RelayError(401, "Pairing expired or revoked. Regenerate the key and pair again.");
  return digest(value);
}
async function authorized(req: Request, role: "browser" | "device" | "either" = "browser"): Promise<Pairing> {
  const hash = bearer(req);
  limit(`auth:${hash}`, role === "device" ? 30 : 180);
  const condition = role === "either" ? "(browser_hash=$1 OR device_hash=$1)" :
    role === "browser" ? "browser_hash=$1" : "device_hash=$1";
  const { rows } = await pool.query<Pairing>(
    `SELECT * FROM phone_otp_pairings WHERE ${condition} AND expires_at>$2`, [hash, Date.now()]);
  if (!rows[0]) throw new RelayError(401, "Pairing expired or revoked. Regenerate the key and pair again.");
  return rows[0];
}
const status = (row: Pairing) => ({
  paired: !!row.device_hash, enabled: row.enabled,
  pairExpiresAt: Number(row.pair_expires_at), expiresAt: Number(row.expires_at),
});
router.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" });
  next();
});
// Expired material is actively erased, including ciphertext; no production DDL.
const cleanup = setInterval(() => {
  void pool.query("DELETE FROM phone_otp_pairings WHERE expires_at<$1 OR (device_hash IS NULL AND pair_expires_at<$1)", [Date.now()])
    .then(() => pool.query("UPDATE phone_otp_pairings SET otp_cipher=NULL WHERE received_at<$1 AND otp_cipher IS NOT NULL", [Date.now() - OTP_TTL]))
    .catch(() => { /* Requests report database failures; never log bodies or credentials. */ });
}, 60_000);
cleanup.unref();

router.post("/pairings", route(async (req, res) => {
  limit(`register:${req.ip}`, 10, PAIR_TTL);
  limit("registration-budget", 200, PAIR_TTL);
  const key = clientKey(), browserToken = token(), now = Date.now();
  await pool.query(
    "INSERT INTO phone_otp_pairings(id,key_hash,browser_hash,pair_expires_at,expires_at,enabled) VALUES($1,$2,$3,$4,$5,true)",
    [randomUUID(), digest(key), digest(browserToken), now + PAIR_TTL, now + SESSION_TTL]);
  res.status(201).json({ clientKey: key, browserToken, pairExpiresAt: now + PAIR_TTL, expiresAt: now + SESSION_TTL });
}));
router.post("/pair", route(async (req, res) => {
  limit(`pair:${req.ip}`, 10, PAIR_TTL);
  const parsed = PairPhoneBody.strict().safeParse(req.body);
  if (!parsed.success) throw new RelayError(400, "Enter the exact Client Key shown in the extension.");
  const deviceToken = token();
  const { rows } = await pool.query<Pairing>(
    "UPDATE phone_otp_pairings SET device_hash=$1 WHERE key_hash=$2 AND device_hash IS NULL AND pair_expires_at>$3 AND expires_at>$3 RETURNING *",
    [digest(deviceToken), digest(parsed.data.clientKey), Date.now()]);
  if (!rows[0]) throw new RelayError(401, "Invalid, expired or already used key. Regenerate it in the extension.");
  res.json({ deviceToken, expiresAt: Number(rows[0].expires_at) });
}));
router.get("/pairing", route(async (req, res) => { res.json(status(await authorized(req, "either"))); }));
router.patch("/pairing", route(async (req, res) => {
  const row = await authorized(req);
  const parsed = UpdatePhonePairingBody.strict().safeParse(req.body);
  if (!parsed.success) throw new RelayError(400, "enabled must be a boolean.");
  await pool.query("UPDATE phone_otp_pairings SET enabled=$1,otp_cipher=NULL WHERE id=$2", [parsed.data.enabled, row.id]);
  res.json({ enabled: parsed.data.enabled });
}));
router.delete("/pairing", route(async (req, res) => {
  const row = await authorized(req, "either");
  await pool.query("DELETE FROM phone_otp_pairings WHERE id=$1", [row.id]);
  res.status(204).end();
}));
router.post("/messages", route(async (req, res) => {
  const row = await authorized(req, "device");
  if (!row.enabled) throw new RelayError(409, "Phone OTP auto-fill is disabled in the extension.");
  const parsed = SendPhoneOTPBody.strict().safeParse(req.body);
  if (!parsed.success) throw new RelayError(400, "Only a six-digit OTP and delivery metadata are accepted.");
  const { clientKey: key, otp, messageId, receivedAt } = parsed.data;
  const now = Date.now();
  if (digest(key) !== row.key_hash) throw new RelayError(401, "Client Key does not match this phone.");
  if (!Number.isSafeInteger(receivedAt) || receivedAt < now - OTP_TTL || receivedAt > now + 30_000)
    throw new RelayError(400, "SMS is expired or the phone clock is incorrect.");
  // Row lock in UPDATE serializes duplicate delivery and out-of-order retries.
  await pool.query(
    `UPDATE phone_otp_pairings SET otp_cipher=$1,message_id=$2,received_at=$3,
      seen_ids=(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM
        (SELECT value FROM jsonb_array_elements(jsonb_build_array($2::text)||seen_ids) WITH ORDINALITY AS ids(value,n) WHERE n<=20) recent)
     WHERE id=$4 AND enabled=true AND expires_at>$5 AND NOT seen_ids ? $2 AND (received_at IS NULL OR received_at<=$3)`,
    [encryptOTP(otp, row.id), messageId, receivedAt, row.id, now]);
  res.status(202).json({ accepted: true });
}));
router.get("/messages", route(async (req, res) => {
  const row = await authorized(req);
  const receivedAt = Number(row.received_at);
  if (!row.enabled || !row.otp_cipher || receivedAt < Date.now() - OTP_TTL) {
    res.json({ success: false }); return;
  }
  res.json({ success: true, otp: decryptOTP(row.otp_cipher, row.id), messageId: row.message_id, receivedAt });
}));
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof RelayError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ code: "PHONE_RELAY_FAILURE" }, "Phone relay request failed");
  res.status(503).json({ error: "Relay unavailable. Try again shortly; manual OTP entry remains available." });
});
export default router;
