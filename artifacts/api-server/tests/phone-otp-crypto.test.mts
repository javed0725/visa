import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, digest, encryptOTP, decryptOTP } from "../src/lib/phone-otp-crypto.ts";
// A test fixture, not an environment/project secret.
process.env.SESSION_SECRET = "unit-test-fixture-only";
test("client keys use an unambiguous alphabet and eight random symbols", () => {
  const keys = new Set(Array.from({length:1000}, clientKey));
  assert.equal(keys.size,1000);
  for (const key of keys) assert.match(key,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});
test("hashed credentials do not expose their original values", () => {
  assert.match(digest("test-input"),/^[a-f0-9]{64}$/);
  assert.notEqual(digest("test-input"),digest("another-input"));
});
test("OTP encryption is randomized and authenticated to one pairing", () => {
  const a=encryptOTP("123456","pair-a"), b=encryptOTP("123456","pair-a");
  assert.notEqual(a,b);
  assert.equal(decryptOTP(a,"pair-a"),"123456");
  assert.throws(()=>decryptOTP(a,"pair-b"));
  const [iv,tag,data]=a.split(".");
  const damaged=Buffer.from(data!,"base64url");damaged[0]^=1;
  assert.throws(()=>decryptOTP(`${iv}.${tag}.${damaged.toString("base64url")}`,"pair-a"));
});
