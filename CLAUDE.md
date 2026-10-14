# CLAUDE.md

Guidance for AI coding agents working in this repository. Read [README.md](README.md) for
setup and architecture; this file covers how to work here safely and what is easy to get wrong.

## Project at a glance

npm-workspaces monorepo (`services/*`), CommonJS, Node 20+, Express 4, Sequelize 6 (MySQL 8),
ioredis (Redis 7), pino, envalid, Umzug, node:test + supertest.

- `services/gateway` — the only public entry point. Owns CORS, helmet, edge rate limiting,
  request IDs, `X-Forwarded-For`, upstream timeouts. Proxies `/auth`, `/tickets` → auth-service and `/files` → file-upload-service.
- `services/auth-service` — identity, billing/credits, support, notifications. Split into
  modules under `src/modules/<context>/` (rules below).
- `services/file-upload-service` — uploads on local disk + `file_records` table.
- `services/platform` — shared runtime: `createLogger`, `requestLogger`, `healthRoutes`,
  `errorHandler`, `startServer`, `migrateUp`. Use it; don't re-implement these per service.
- `services/shared-auth` — JWT verification for services other than auth-service.

Each service has `src/app.js` exporting `createApp()` (no listening, no connections) and an
`index.js` that validates config, connects, optionally migrates, then calls `platform.startServer`.

## Commands

Run from the repo root unless noted.

```bash
npm test                                   # all unit tests (no DB/Redis needed) — must pass
npm run lint                               # ESLint + auth-service module boundaries — must pass
npm run test:integration                   # needs MySQL + Redis; DROPS tables in DB_NAME (see README)
npm run migrate                            # apply migrations for both services
npm test -w services/auth-service          # one package
node --test --test-name-pattern="refresh" services/auth-service/test/unit/app.test.js   # one test
docker compose config --quiet              # validate compose after editing it
```

Workspace flags take paths relative to the repo root (`-w services/auth-service`); running
them from inside `services/` fails.

## Definition of done

1. `npm run lint` and `npm test` pass.
2. Behaviour changes have tests: unit tests for logic and HTTP behaviour; integration tests
   (`test/integration/`) for anything that depends on real SQL, transactions, Redis or
   column sizes. **Stubbed-DB unit tests cannot catch schema problems** — a 654-char token
   in a `VARCHAR(500)` column passed every unit test and broke sign-in against real MySQL.
3. Schema changes ship as a migration; new settings are added to the service's env
   validator **and** its `.env.example`; docs (README / module README) are updated when
   commands, endpoints or architecture change.
4. If you could not run something (integration tests, Docker build), say so explicitly.

## Hard rules

**Security**
- Never commit secrets, keys, `.env` files or user uploads. `services/keys/` and `uploads/`
  are git-ignored; keep it that way. Development keys come from `npm run keys:generate`.
- JWTs are RS256 with a `typ` claim (`access` | `refresh` | `reset`), `iss`, `aud`, `kid`.
  Every verify must check the type. Never accept a non-access token as authentication.
- Store only hashes of refresh tokens (`hashRefreshToken`). Reset tokens are single-use (jti in Redis).
- Compare secrets/signatures/OTPs with `crypto.timingSafeEqual` (check lengths first).
- Every route that reads or changes user data checks ownership (`where: { ..., userId: req.user.userId }`).
- Validate every request body/param with express-validator in the module's `validator.js`,
  ending the chain with `handleValidationErrors` (`src/shared/middleware/validate.js`).
- 5xx responses never include `error.message`, SQL or stack traces — use `next(err)` or a
  generic message; `platform.errorHandler` handles the rest.
- Service-to-service endpoints use `requireInternal` (`X-Internal-Token`), not user auth.
- Don't log tokens, OTPs, passwords or email bodies. pino redaction covers headers and
  `?token=`/`?code=`; anything else you log is your responsibility.

**Architecture**
- auth-service modules import each other **only** via their `index.js` (`require('../billing')`).
  `src/shared/` never imports a module. `npm run lint:boundaries -w services/auth-service` enforces this.
- One writer per table/column. `users.credits` is written only by `modules/billing/credits.js`.
- Cross-module side effects go through `src/shared/events.js`. Channel names (`credit:update`,
  `notification:new`) are a cross-service contract — don't rename them.
- No cross-module or cross-service Sequelize associations; reference rows by id.
- CORS and security headers belong to the gateway only. Don't add `cors()` to services.
- Services must not be directly internet-reachable; they trust `X-Forwarded-For` (`TRUST_PROXY`).

**Database**
- Never use `sequelize.sync()` or ad-hoc `ALTER TABLE` at startup. Add a migration:
  `services/<service>/migrations/YYYYMMDDHHMMSS-description.js` exporting `up`/`down`
  with `{ context: { queryInterface, Sequelize } }`.
- Migrations must be safe on databases created by the old `sync()` code: check
  `showAllTables` / `describeTable` / `showIndex` before creating or altering.
- Never edit a migration that may already have run; add a new one.
- Multi-row or read-then-write money/credit logic runs in a transaction with row locks
  (`lock: t.LOCK.UPDATE`) or conditional updates.

**Configuration**
- New env vars: add to `src/config/env.js` / `src/shared/config/env.js` (envalid) and to `.env.example`.
  Required-in-production rules live in the same validator.
- Modules read `process.env` at load time (JWT keys, Passport, Razorpay). Validate config
  before requiring the app (see `index.js`), and in tests set env before any `require`.

## Code conventions

- CommonJS, 4-space indent, single quotes, semicolons. Match surrounding code; ESLint config
  is `eslint.config.js` (`no-console` warns — use the service logger).
- Logging: `req.log` inside request handlers (carries the request ID), otherwise the
  service logger (`src/shared/logger.js`). Pass errors as `{ err }`: `req.log.error({ err }, 'Signup failed')`.
- Controllers: `try { ... } catch (error) { req.log.error({ err: error }, '...'); res.status(500).json({ error: '<generic>' }) }`
  or `next(error)`.
- Callbacks that run inside streams (e.g. multer `destination`/`filename`) must report
  errors via the callback, never throw — a throw there crashes the process.
- Keep JSDoc short and on exported functions; comment *why*, not *what*.

## Tests

- Framework: `node:test` + `node:assert/strict` + `supertest`. Files: `test/unit/*.test.js`,
  `test/integration/*.test.js`.
- auth-service tests start with `require('../helpers/env')` (sets env and throwaway keys)
  and, for unit tests, `installStubRedis()` before loading app code. Fake DB calls by
  replacing model methods (`User.findByPk = async () => ...`) inside `before()`.
- Integration tests skip unless `INTEGRATION=1`, reset a database whose name contains "test",
  run migrations, and capture email via `installMailCapture()`.
- Test behaviour through HTTP (`createApp()` + supertest) where possible, not internals.

## Gotchas seen in this repo

- **Port 5000 on macOS** is AirPlay Receiver: an empty `403` with `Server: AirTunes` means
  you're not hitting the gateway. Use `GATEWAY_HOST_PORT=5050` with compose.
- **`npm audit fix --omit=dev` uninstalls dev dependencies** (ESLint, supertest). Run
  `npm install` afterwards, or don't pass `--omit=dev` to `fix`.
- **Docker named volumes** keep the ownership they were created with. If you change a
  directory's owner in the Dockerfile, existing volumes need recreating.
- **Remaining audit warnings** come from `http-proxy-middleware` (we don't use its `router`
  option); CI fails only on critical advisories.
- The `agents` module is defined but **not mounted**; its tables are written by another
  codebase. Don't create migrations for `agents`/`agent_logs` here.

## Git and change hygiene

- Don't commit, push, rewrite history or force-push unless asked. Never commit to `main` directly.
- Keep changes scoped to the request; mention unrelated issues instead of fixing them silently.
- Anything touching auth, payments, migrations or secrets: call out the risk and what was
  (and wasn't) verified.
