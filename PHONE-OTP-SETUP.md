# Phone OTP Auto-Fill — getting started

## Downloads

- **visa-automator-pro-chrome.zip**: complete Chrome extension, version 2.0.
  Extract and load the directory containing `manifest.json` at
  `chrome://extensions` → Developer mode → Load unpacked.
- **visa-otp-companion-debug.apk**: native Android companion, Android 8 or newer.
  This is a debug-signed private-testing build, not a Play Store release.
  Android may ask permission to install from the download source.
- **visa-phone-otp-source.zip**: Android source, relay source/schema, extension,
  build files and this guide. No application credentials are embedded.

## Connect once

1. **Run/publish the relay.** Use a public HTTPS origin with a valid certificate.
   This project has no published URL yet. A private workspace preview is not an
   externally accessible relay. The relay uses its own per-device bearer tokens;
   no Firebase, Termux, MacroDroid, SMS-provider account or paid SMS API is needed.
2. In the IVAC extension panel click **Relay setup**. Enter the HTTPS origin,
   approve Chrome access to that one origin, and save. Back in the panel enable
   **Phone OTP auto-fill**, then copy the generated Client Key.
3. Open the Android app. Enter the same relay address and the Client Key. Tap
   **Pair phone** within ten minutes. Read the SMS disclosure and use
   **Grant SMS access**. Pair only a phone you own/control.
4. Keep the IVAC OTP tab active and press **Start**. A matching incoming SMS is
   filtered on the phone, its six-digit code is relayed, and the extension fills
   the OTP field, dispatches input/change events, and clicks Verify once.

Manual typing/pasting and manual website Verify remain supported. Automatic
receipt does not override a user who has started entering the OTP manually.
The extension waits for the verified page transition; clicking Verify alone
never counts as verification success. Payment/final booking remain manual.

## Security and lifetime

- The visible key is an eight-symbol, cryptographically random, **single-use
  pairing code**, not a credential for reading OTPs. It expires after ten minutes.
- The phone receives a write-only credential; the browser receives a separate
  read/control credential. Tokens and pairing keys are hashed in PostgreSQL.
- OTPs are AES-256-GCM encrypted with a key derived from `SESSION_SECRET`, bound
  to their pairing, and expire after two minutes. A cleanup job removes expired
  ciphertext. No full SMS body, sender number, or SMS history is uploaded.
- Android credentials/queued codes are Keystore-encrypted in app-private storage.
  Cloud/device backup is disabled. The app has no SMS history-reading code.
- Android requests `RECEIVE_SMS` and `READ_SMS` as specified; only RECEIVE_SMS is
  required by its incoming-message implementation. It never becomes the default
  SMS app or sends SMS. SMS permissions are restricted by Android/Google Play;
  this APK is intended for consented private testing, not guaranteed Play approval.
- Paired sessions expire after **24 hours**. Generate a new key to pair again.
  **New key**, changing relay address, **Unpair**, and **RESET** revoke credentials.
  If remote revocation fails, the UI warns and the other device should also be
  unpaired. Lost devices should be revoked immediately with New key.
- Disabling auto-fill clears relay OTP data and rejects new submissions while
  disabled. Only the active IVAC tab can fetch a code. Submitted delivery IDs are
  remembered locally to prevent reuse after a browser refresh.
- The relay validates timestamp, UUID, exact six-digit payload, role and key.
  It ignores duplicate/out-of-order messages, rate-limits pairing and requests,
  uses no-store responses, and excludes request bodies/authorization from logs.

## Relay operation

The backend is the existing `artifacts/api-server` Express service. It serves:

```
POST   /api/phone-otp/pairings   Generate browser credential + Client Key
POST   /api/phone-otp/pair       Redeem Client Key for phone write credential
GET    /api/phone-otp/pairing    Pairing status (either credential)
PATCH  /api/phone-otp/pairing    Enable/disable (browser credential)
DELETE /api/phone-otp/pairing    Revoke both credentials (either credential)
POST   /api/phone-otp/messages   Send OTP (phone credential)
GET    /api/phone-otp/messages   Fetch current OTP (browser credential)
```

`Authorization: Bearer …` is used for authenticated endpoints. Never put
credentials or OTPs into URLs or logs. API contracts are in
`lib/api-spec/openapi.yaml`; schema is in `lib/db/src/schema/phone-otp.ts`.

Required runtime configuration:

- `DATABASE_URL`: PostgreSQL connection, supplied through the hosting secret system.
- `SESSION_SECRET`: stable, strong application secret for encryption.
- `PORT`: listener port, provided by the managed workflow in this project.

Development schema has been added. On Replit, Publish applies managed production
schema changes. Do not put migration/DDL code in production startup.
For a standalone PostgreSQL host, apply `phone-otp-schema.sql` before starting.

```
pnpm install
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
# Set required runtime configuration securely, then:
pnpm --filter @workspace/api-server run start
```

Use HTTPS termination at the hosting proxy. The clients reject plaintext HTTP
and redirects. PostgreSQL preserves pairings across restarts and scales;
request-rate counters are process-local, so add a shared edge rate limit for
large multi-instance/public deployments. No production URL is hardcoded.

## Android build and troubleshooting

Open `android-companion` in Android Studio, install Android SDK 35 and JDK 17,
then build:

```
cd android-companion
./gradlew assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. SDK location can be configured
with `ANDROID_HOME` or a local `local.properties` file (never commit that file).
For distribution beyond private testing, create your own release signing
configuration securely; do not reuse the debug signing key.

Incoming multipart SMS is combined before filtering. The receiver requires an
`IVACBD` signature in the sender/header or message body and the phrase
`For security, type the following sequence when prompted`, followed by exactly
six number words. Underscores, spaces, mixed separators and case differences are
accepted; brackets around the sequence are optional. For example,
`Zero_Two_Seven_Nine_Two_Two` becomes the string `027922`, preserving the leading
zero. Numeric-only OTP messages, unrelated messages, incomplete sequences and
multiple matching sequences are ignored. Only the converted code and delivery
metadata are forwarded under the paired Client Key; the SMS body is not uploaded.
Filtering rules live in `OtpParser.java`.

If nothing arrives:

1. Use **Check connection** on the phone; verify the same HTTPS address/key was used.
2. Check SMS permission in Android settings and enable auto-fill in Chrome.
3. Reopen a force-stopped app. Some manufacturers delay background work in deep
   sleep; allow background activity for this companion if the device requires it.
4. Keep both devices online and the IVAC OTP tab active. Keep phone time accurate.
5. Expired/revoked keys require a new key and pairing; old SMS codes are not reused.

Android uses JobScheduler work items for delivery and exponential network retries
until the code expires; no continuously running foreground service is needed.
OS/battery restrictions can still delay delivery. This is near-real-time polling,
not a guarantee of instantaneous delivery in every power/network state.

## Verification

- Extension workflow and relay-worker unit tests.
- Real HTTP/PostgreSQL relay tests for pairing, isolation, delivery, duplicate and
  expiry rejection, pause/resume and revocation.
- Encryption/key-generation tests and native SMS parser tests.
- Native Android debug build and APK signature verification.
- Browser fixture checks used the real options/content scripts and real relay
  through a simulated Chrome API bridge. The real installed Chrome worker and
  permission prompt were not exercised in that browser environment.
- Physical incoming-SMS delivery on a user's phone and authenticated live IVAC
  markup must still be verified on those devices; neither is simulated as proven.
