import { pgTable, text, bigint, boolean, jsonb } from "drizzle-orm/pg-core";

// Tokens and the pairing key are hashed. OTP payloads are encrypted, never SMS bodies.
export const phoneOTPPairings = pgTable("phone_otp_pairings", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  browserHash: text("browser_hash").notNull().unique(),
  deviceHash: text("device_hash").unique(),
  pairExpiresAt: bigint("pair_expires_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  otpCipher: text("otp_cipher"),
  messageId: text("message_id"),
  receivedAt: bigint("received_at", { mode: "number" }),
  seenIds: jsonb("seen_ids").$type<string[]>().notNull().default([]),
});
