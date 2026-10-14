# CLAUDE.md

Guidance for AI coding agents working in this repository. Read [README.md](README.md) for
setup and architecture; this file covers how to work here safely and what is easy to get wrong.

## Project at a glance

npm-workspaces monorepo (`services/*`), **TypeScript (strict)** compiled to CommonJS, Node 20+,
Express 4, Sequelize 6 (MySQL 8), ioredis (Redis 7), pino, envalid, Umzug, node:test + supertest.

- `services/gateway` — the only public entry point. Owns CORS, helmet, edge rate limiting,
  request IDs, `X-Forwarded-For`, upstream timeouts. Proxies `/auth`, `/tickets` → auth-service and `/files` → file-upload-service.
- `services/auth-service` — identity, billing/credits, support, notifications. Split into
  modules under `src/modules/<context>/` (rules below).
- `services/file-upload-service` — uploads on local disk + `file_records` table.
- `services/platform` — shared runtime: `createLogger`, `requestLogger`, `healthRoutes`,
  `errorHandler`, `HttpError`, `startServer`, `configReporter`, `migrateUp`, `Migration` type.
  Use it; don't re-implement these per service.
- `services/shared-auth` — JWT verification for services other than auth-service.

Every package has `src/` (compiled by `tsc -b` to `dist/`), `test/` (its own `tsconfig.json`,
`noEmit`, run with tsx) and `tsconfig.json` extending `tsconfig.base.json`. Services have
`src/app.ts` exporting `createApp()` (no listening, no connections) and `src/index.ts`, which
validates config, connects, optionally migrates, then calls `platform.startServer`.
Production runs `node dist/index.js`; nothing in production depends on tsx or TypeScript.

## Commands

Run from the repo root unless noted.

```bash
npm run build                              # tsc -b: platform, shared-auth, then services → dist/
npm run typecheck                          # build + type-check every test/ and scripts/ project — must pass
npm run lint                               # type-aware ESLint + auth-service module boundaries — must pass
npm test                                   # build, then all unit tests (no DB/Redis) — must pass
npm run test:integration                   # needs MySQL + Redis; DROPS tables in DB_NAME (see README)
npm test -w services/auth-service          # one package (shared packages must be built first)
node --import tsx --test --test-name-pattern="refresh" services/auth-service/test/unit/app.test.ts   # one test
npm run dev -w services/auth-service       # tsx watch src/index.ts
docker compose config --quiet              # validate compose after editing it
```

Workspace flags take paths relative to the repo root (`-w services/auth-service`); running
them from inside `services/` fails. Services import `@ai-search/platform` / `shared-auth`
from their `dist/`, so run `npm run build` after changing a shared package.

## Definition of done

1. `npm run typecheck`, `npm run lint` and `npm test` pass.
2. Behaviour changes have tests: unit tests for logic and HTTP behaviour; integration tests
   (`test/integration/`) for anything that depends on real SQL, transactions, Redis or
   column sizes. **Stubbed-DB unit tests cannot catch schema problems** — a 654-char token
   in a `VARCHAR(500)` column passed every unit test and broke sign-in against real MySQL.
3. Schema changes ship as a migration; new settings are added to the service's env
   validator **and** its `.env.example`; docs (README / module README) are updated when
   commands, endpoints or architecture change.
4. If you could not run something (integration tests, Docker build), say so explicitly.

## TypeScript rules

- Compiler settings live in `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`,
  `noUnusedLocals/Parameters`, `noImplicitReturns`). Don't loosen them per package.
- No `any` and no `// @ts-ignore`. Use `unknown` and narrow. A cast (`as T`) needs a reason
  in a comment when it isn't obvious (e.g. a library typed as returning `any`).
- `catch (err)` gives `unknown`: use `err instanceof Error ? err.message : String(err)`,
  or log it as `{ err }`.
- Sequelize models are classes: `class X extends Model<InferAttributes<X>, InferCreationAttributes<X>>`
  with `declare` fields and `CreationOptional<>` for defaults/nullable columns, then `X.init(...)`.
  Keep the TypeScript field types in sync with the column definitions.
- Handlers are typed `RequestHandler<Params, unknown, Body>`. Route params use a **type
  alias** (`type P = { id: string }`), not an interface (interfaces lack the index signature
  Express expects). The body type describes what the validator chain guarantees.
- `req.user` is typed via `Express.User` (`AuthUser`: `userId`, `email`, `isVerified`). In
  handlers mounted after `authenticate`, use `currentUser(req)` instead of `req.user!`.
- Event payloads are typed in `src/shared/events.ts` (`EventPayloads`); add new events there.
- Imports: ES `import` syntax (compiled to CommonJS). Use `import type` for types only
  (ESLint enforces `consistent-type-imports`). No `require()` except deliberate lazy loads,
  marked with an eslint-disable comment explaining why.

## Hard rules

**Security**
- Never commit secrets, keys, `.env` files or user uploads. `services/keys/` and `uploads/`
  are git-ignored; keep it that way. Development keys come from `npm run keys:generate`.
- JWTs are RS256 with a `typ` claim (`access` | `refresh` | `reset`), `iss`, `aud`, `kid`.
  Every verify must check the type. Never accept a non-access token as authentication.
- Store only hashes of refresh tokens (`hashRefreshToken`). Reset tokens are single-use (jti in Redis).
- Compare secrets/signatures/OTPs with `crypto.timingSafeEqual` (check lengths first).
- Every route that reads or changes user data checks ownership (`where: { ..., userId }`).
- Validate every request body/param with express-validator in the module's `validator.ts`,
  ending the chain with `handleValidationErrors` (`src/shared/middleware/validate.ts`).
- 5xx responses never include `error.message`, SQL or stack traces — use `next(err)` or a
  generic message; `platform.errorHandler` handles the rest. Throw `HttpError(4xx, msg)` for client errors.
- Service-to-service endpoints use `requireInternal` (`X-Internal-Token`), not user auth.
- Don't log tokens, OTPs, passwords or email bodies. pino redaction covers headers and
  `?token=`/`?code=`; anything else you log is your responsibility.

**Architecture**
- auth-service modules import each other **only** via their `index.ts` (`import { authenticate } from '../identity'`).
  `src/shared/` never imports a module. `npm run lint:boundaries -w services/auth-service` enforces this.
- One writer per table/column. `users.credits` is written only by `modules/billing/credits.ts`.
- Cross-module side effects go through `src/shared/events.ts`. Channel names (`credit:update`,
  `notification:new`) are a cross-service contract — don't rename them.
- No cross-module or cross-service Sequelize associations; reference rows by id.
- CORS and security headers belong to the gateway only. Don't add `cors()` to services.
- Services must not be directly internet-reachable; they trust `X-Forwarded-For` (`TRUST_PROXY`).

**Database**
- Never use `sequelize.sync()` or ad-hoc `ALTER TABLE` at startup. Add a migration:
  `services/<service>/src/migrations/YYYYMMDDHHMMSS-description.ts` exporting
  `up` and `down` typed `Migration` from `@ai-search/platform` (context: `{ queryInterface, DataTypes }`).
- Migration names are recorded with a `.js` extension whether they ran from `src` (tsx) or
  `dist`; never rename a migration file after it may have run, and never edit one — add a new one.
- Migrations must be safe on databases created by the old `sync()` code: check
  `showAllTables` / `describeTable` / `showIndex` before creating or altering.
- Multi-row or read-then-write money/credit logic runs in a transaction with row locks
  (`lock: t.LOCK.UPDATE`) or conditional updates.

**Configuration**
- New env vars: add to the service's envalid validator (`src/shared/config/env.ts` or
  `src/config/env.ts`) and to `.env.example`. Required-in-production rules live there too.
- Modules read `process.env` at load time (JWT keys, Passport, Razorpay). ES imports are
  hoisted, so ordering is by import order: `src/index.ts` imports `dotenv/config`, then
  `./…/config/validated` **before anything else** — keep it that way.

## Code conventions

- 4-space indent, single quotes, semicolons. Match
  surrounding code; `no-console` warns — use the service logger.
- Logging: `req.log` inside request handlers (carries the request ID), otherwise the
  service logger (`src/shared/logger.ts`). Pass errors as `{ err }`: `req.log.error({ err }, 'Signup failed')`.
- Controllers: `try { ... } catch (error) { req.log.error({ err: error }, '...'); return res.status(500).json({ error: '<generic>' }) }`
  or `next(error)`. Express 4 doesn't catch async rejections — every async handler must
  handle its own errors (that's why `no-misused-promises` allows async handlers).
- Callbacks that run inside streams (e.g. multer `destination`/`filename`) must report
  errors via the callback, never throw — a throw there crashes the process.
- Close Redis clients with `closeRedis()` (not `quit()`): `quit()` hangs forever if the
  client never connected.
- Keep JSDoc short and on exported functions; comment *why*, not *what*. Types replace `@param {Type}`.

## Tests

- Framework: `node:test` + `node:assert/strict` + `supertest`, run with `node --import tsx --test`.
  Files: `test/unit/*.test.ts`, `test/integration/*.test.ts`. Each `test/` has its own tsconfig
  and is covered by `npm run typecheck`.
- Setup happens through **side-effect imports, in order**, before any app import:
  `import '../helpers/env'` (env + throwaway keys), then `import '../helpers/useStubRedis'`
  (unit) or `'../helpers/captureMail'` (integration). Moving these below an app import breaks them.
- Fake DB calls with `stubMethod(Model, 'findByPk', impl)` from `test/helpers/stub.ts` inside `before()`.
- Integration suites use `describe(..., { skip: !enabled })` and load app modules lazily
  (typed `require` in `before()`) so a skipped run opens no connections and exits cleanly.
- Test behaviour through HTTP (`createApp()` + supertest) where possible, not internals.

## Gotchas seen in this repo

- **Port 5000 on macOS** is AirPlay Receiver: an empty `403` with `Server: AirTunes` means
  you're not hitting the gateway. Use `GATEWAY_HOST_PORT=5050` with compose.
- **`npm audit fix --omit=dev` uninstalls dev dependencies** (TypeScript, ESLint, supertest).
  Run `npm install` afterwards, or don't pass `--omit=dev` to `fix`.
- **`import()` in this CommonJS build is a real ESM import** and needs file extensions;
  use a typed `require()` for lazy loading instead.
- **http-proxy doesn't abort upstream requests when the client disconnects** (Node no
  longer emits `aborted` for completed GETs). The gateway destroys the upstream request on
  client `close` — keep that, or every closed SSE stream leaks a connection.
- **Docker named volumes** keep the ownership they were created with. If you change a
  directory's owner in the Dockerfile, existing volumes need recreating.
- **Docker build on this machine uses the legacy builder**; a failed `COPY` prints only
  `COPY failed` — check for "Successfully tagged", not just exit noise.
- **Remaining audit warnings** come from `http-proxy-middleware` (we don't use its `router`
  option); CI fails only on critical advisories.
- The `agents` module is defined but **not mounted**; its tables are written by another
  codebase. Don't create migrations for `agents`/`agent_logs` here.

## Git and change hygiene

- Don't commit, push, rewrite history or force-push unless asked. Never commit to `main` directly.
- Keep changes scoped to the request; mention unrelated issues instead of fixing them silently.
- Anything touching auth, payments, migrations or secrets: call out the risk and what was
  (and wasn't) verified.
