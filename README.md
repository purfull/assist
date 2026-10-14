# AI Search Backend

Backend for the AI Search platform: Node.js services in an npm-workspaces monorepo,
behind a single API gateway.

```
                   ┌──────────────┐
  browser / apps → │   gateway    │  :5000  CORS, security headers, edge rate limit,
                   │ (only public)│         request IDs, X-Forwarded-For, timeouts
                   └──────┬───────┘
          /auth/*, /tickets/*   /files/*
                 │                 │
        ┌────────▼───────┐  ┌──────▼──────────────┐
        │  auth-service  │  │ file-upload-service │
        │     :5001      │  │        :5005        │
        └──┬─────────┬───┘  └──────┬──────────────┘
           │         │             │   verifies JWTs via auth-service JWKS
        MySQL 8    Redis 7       MySQL 8 + local disk (UPLOAD_DIR)
```

| Package | Port | Responsibility |
|---|---|---|
| [`services/gateway`](services/gateway) | 5000 | The only public entry point |
| [`services/auth-service`](services/auth-service/README.md) | 5001 | Identity, billing/credits (Razorpay), support tickets, notifications + SSE |
| [`services/file-upload-service`](services/file-upload-service) | 5005 | User file uploads and downloads |
| [`services/platform`](services/platform) | — | Shared library: logging, request IDs, errors, health checks, graceful shutdown, migrations |
| [`services/shared-auth`](services/shared-auth) | — | Shared library: JWT verification middleware (JWKS or PEM) |

`auth-service` is internally split into bounded-context modules (identity, billing,
notifications, support, agents) with enforced import rules — see
[services/auth-service/src/modules/README.md](services/auth-service/src/modules/README.md).

## Requirements

- Node.js 20+ (CI runs 20 and 22; images use 22)
- MySQL 8 and Redis 7 — or Docker (Docker Desktop, or [Colima](https://github.com/abiosoft/colima) on macOS)

## Quick start with Docker

```bash
npm install
npm run docker:up
```

This generates development JWT keys in `services/keys/` (git-ignored), builds the images
and starts MySQL, Redis, both services and the gateway on http://localhost:5000.
Migrations run on startup. Only the gateway is published to the host.

- **macOS:** port 5000 is taken by AirPlay Receiver (requests return an empty 403 from
  `AirTunes`). Turn it off in System Settings → General → AirDrop & Handoff, or use
  another port: `GATEWAY_HOST_PORT=5050 npm run docker:up`.
- **Emails** are logged, not sent. Read a signup OTP with
  `docker compose exec redis redis-cli get otp:<email>`.
- Stop with `npm run docker:down` (add `-v` to `docker compose down` to also delete data).

## Running locally without Docker

```bash
npm install
npm run keys:generate
cp services/gateway/.env.example services/gateway/.env
cp services/auth-service/.env.example services/auth-service/.env
cp services/file-upload-service/.env.example services/file-upload-service/.env
# edit the .env files (database credentials etc.)
npm run migrate
npm run dev:all
```

Each service validates its configuration at startup and exits naming every missing or
invalid setting. Each `.env.example` documents its variables.

## Development

| Command | What it does |
|---|---|
| `npm test` | Unit tests for every package (no database needed) |
| `npm run test:integration` | Integration tests against real MySQL + Redis (see below) |
| `npm run lint` | ESLint plus the auth-service module-boundary check |
| `npm run migrate` | Apply pending migrations for both services |
| `npm run keys:generate` | Create development JWT keys (`-- --force` replaces them) |
| `npm run dev:all` / `start:all` | Run all three services (nodemon / node) |

### Integration tests

They need MySQL and Redis and **drop every table** in the database named by `DB_NAME`
(default `ai_search_test`; they refuse to run if the name doesn't contain "test").
Throwaway containers:

```bash
docker run -d --rm --name ai-test-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=ai_search_test -p 3307:3306 mysql:8.4
docker run -d --rm --name ai-test-redis -p 6380:6379 redis:7.4-alpine
DB_PORT=3307 DB_PASSWORD=root REDIS_PORT=6380 npm run test:integration
```

### Database changes

Schema changes are Umzug migrations in `services/<service>/migrations/`, one bookkeeping
table per service (`migrations_auth`, `migrations_files`). Never use `sequelize.sync()`.
Migrations must be safe to run on databases created by the old `sync()` code (check
before creating or altering). `npm run migrate -w services/auth-service -- pending` lists
what would run.

### CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: lint and
unit tests (Node 20 and 22), integration tests against MySQL and Redis, a production
dependency audit (fails on critical), a secret scan and Docker image builds.

## Repository layout

```
.github/workflows/ci.yml     CI pipeline
Dockerfile                   One image for any service: --build-arg SERVICE=<dir>
docker-compose.yml           Full local stack
eslint.config.js             Lint rules for the whole repo
scripts/generate-keys.js     Development JWT key pair → services/keys/
services/
  gateway/                   src/app.js (createApp), src/config.js, test/
  auth-service/              src/app.js, src/modules/<context>/, src/shared/, migrations/, test/
  file-upload-service/       src/app.js, src/controllers, src/config, migrations/, test/
  platform/                  shared runtime library (+ migrations.js)
  shared-auth/               JWT verification middleware
  keys/                      development keys (git-ignored)
```

## API overview

All traffic goes through the gateway. Authenticated endpoints take
`Authorization: Bearer <access token>`; the refresh token is an HttpOnly cookie.

| Prefix | Service | Examples |
|---|---|---|
| `/auth/*` | auth-service | signup/signin/OTP, password reset, Google OAuth (`/auth/google` → `?code=` → `POST /auth/google/exchange`), `/auth/me`, profile, devices, `/auth/.well-known/jwks.json` |
| `/auth/payment/*` | auth-service (billing) | Razorpay orders, verify, fail, transaction history |
| `/auth/notifications`, `/auth/credits/stream` | auth-service (notifications) | list/mark read; SSE stream of credits and notifications |
| `/tickets/*` | auth-service (support) | create, list, read, reply |
| `/files/*` | file-upload-service | upload (multipart `files`), list, download, replace, delete |

Full endpoint list: [services/auth-service/README.md](services/auth-service/README.md).
Every service exposes `GET /health` (liveness) and `GET /health/ready` (dependencies).

## Operations

- **Logs** are JSON (pino) with a request ID that the gateway assigns and forwards
  (`X-Request-Id`). Authorization headers, cookies, internal tokens and `?token=` / `?code=`
  query values are redacted.
- **Shutdown**: on SIGTERM services stop accepting connections, close DB/Redis and exit
  (open SSE connections are closed after half the 10s grace period).
- **Secrets** come from environment variables or mounted files; never commit `.env` files
  or keys. Production requires JWT keys, a 32+ character `INTERNAL_SERVICE_TOKEN` and Mailgun.
- **Only the gateway** may be exposed publicly; services trust `X-Forwarded-For` from it
  (`TRUST_PROXY`, default 1 hop).
- **Scaling limits today:** uploads are stored on local disk and the gateway and file
  service rate limits are in-memory, so those two are single-instance until moved to
  object storage / Redis. auth-service rate limits and events already use Redis.

## Security

- Access, refresh and reset JWTs are RS256 with a `typ` claim; only access tokens
  authenticate requests. Refresh tokens are stored hashed; reset links are single-use.
- Report vulnerabilities privately to the maintainers rather than in public issues.
