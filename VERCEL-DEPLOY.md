# Deploy the Phone OTP relay to Vercel

This project is a pnpm workspace. Deploy it from the **repository root** so the
API function can resolve the shared database and API-schema packages.

## Before deploying

You need:

- A PostgreSQL database that accepts connections from Vercel. A hosted provider
  such as Neon or Supabase can be used; choose its pooled connection URL if it
  provides one.
- A stable `SESSION_SECRET`, which encrypts OTPs at rest.
- A GitHub repository containing this project.

Apply the relay table schema once to the chosen PostgreSQL database, using its
SQL console:

```sql
CREATE TABLE IF NOT EXISTS phone_otp_pairings (
  id text PRIMARY KEY,
  key_hash text NOT NULL UNIQUE,
  browser_hash text NOT NULL UNIQUE,
  device_hash text UNIQUE,
  pair_expires_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  otp_cipher text,
  message_id text,
  received_at bigint,
  seen_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);
```

The same schema is in `phone-otp-schema.sql`. Do not run schema changes from a
serverless request or commit database credentials.

## Push this project to GitHub

From the project root, create an empty GitHub repository first, then use its SSH
or HTTPS URL in place of the placeholder:

```bash
git add api vercel.json VERCEL-DEPLOY.md \
  PHONE-OTP-SETUP.md \
  artifacts/api-server/src/routes/phone-otp.ts \
  lib/db/src/index.ts
git commit -m "Prepare OTP relay for Vercel"
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

If `origin` is already configured, skip `git remote add origin`. Keep
`.env` files, database URLs, and secret values out of Git.

## Import and deploy on Vercel

1. In Vercel, create a project by importing the GitHub repository.
2. Set **Root Directory** to the repository root (leave it as `.`); do not set
   it to `artifacts/api-server`.
3. Use the detected pnpm package manager. The checked-in `vercel.json` runs the
   workspace install and type checks; the API function is under `api/`.
4. In the project’s Environment Variables settings, add these for **Production**
   (and Preview too if you will test preview deployments):
   - `DATABASE_URL`: PostgreSQL connection URL.
   - `SESSION_SECRET`: a long random value, generated locally with
     `openssl rand -base64 32`. Do not paste it into chat or source files.
5. Deploy. Vercel provides a public HTTPS domain for the project. Test
   `https://<your-vercel-domain>/api/healthz`; it should return
   `{"status":"ok"}`.
6. Enter the HTTPS **origin only** (for example `https://your-project.vercel.app`)
   in the extension’s Relay setup page and use the same origin in the Android
   companion. The extension and phone then call `/api/phone-otp/...`.

For a new Vercel project, deploy a Preview first if you want to validate the
database and secrets before promoting it to Production. Use separate databases
for Preview and Production if you do not want test pairings to share data.

## OTP delivery behavior on Vercel

The API remains backed by PostgreSQL; process memory is not used to store pairing
credentials or OTPs. Vercel functions cannot depend on a permanent process or
shared in-memory listener, so `/api/phone-otp/messages/wait` checks the persisted
OTP row every 500 ms for up to 20 seconds, then returns so the extension can
reconnect. A push is normally picked up on the next check, but carrier, phone,
network, browser, and serverless scheduling delays still apply.

The function timeout is configured to 30 seconds to allow that bounded wait.
Request counters are per serverless process, not a global rate limiter. For a
public production relay with significant traffic, add shared edge/database rate
limiting and monitor the PostgreSQL connection limits.

Vercel supplies HTTPS and a public project URL, but free-plan eligibility, usage
limits, and continued free availability are controlled by Vercel and can change.
This configuration does not guarantee a permanent free deployment.
