# Visa Automator Pro

Chrome appointment extension with a native Android Phone OTP companion and an HTTPS relay.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (managed `PORT`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required configuration: `DATABASE_URL` (PostgreSQL), `SESSION_SECRET` (OTP encryption), managed `PORT`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `extension/`: complete unpacked-loadable Chrome extension; preserve the adaptive workflow.
- `android-companion/`: native Android pairing, incoming-SMS filter and encrypted delivery queue.
- `PHONE-OTP-SETUP.md`: install, pairing, security, hosting and build instructions.
- `lib/api-spec/openapi.yaml`: relay contracts; `lib/db/src/schema/phone-otp.ts`: persistence.
- `artifacts/api-server/`: shared Express relay; never log SMS bodies, OTPs or credentials.

## Architecture decisions

- Pairing keys are bootstrap codes, not credentials for reading OTPs.
- Native Android is used because SMS reception needs platform permissions/receivers.
- Termux/MacroDroid was replaced at the user's request; OTP verification still submits once and respects manual entry.
- Publishing applies managed production schema changes; do not run DDL at server startup.

## Product

The on-page panel controls appointment automation, four primary-first document
slots, center selection and middle-first calendar retries. The phone companion
forwards only matching visa OTPs with consent; final payment/confirmation is manual.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
