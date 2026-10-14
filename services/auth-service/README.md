# auth-service

Identity, billing (credits and Razorpay), support tickets and notifications for the AI
Search platform. Internally it is split into bounded-context modules; see
[src/modules/README.md](src/modules/README.md) for ownership and import rules.

It sits behind the gateway and must not be reachable directly. CORS and security headers
are handled by the gateway.

## Run

```bash
cp .env.example .env              # then fill in values
npm run keys:generate             # from the repo root: dev JWT keys in services/keys/
npm run migrate                   # or set MIGRATE_ON_START=true
npm run dev
```

Configuration is validated at startup (`src/shared/config/env.js`); missing or invalid
settings stop the service with a message naming them.

## Endpoints (through the gateway)

| Area | Endpoints |
|---|---|
| Identity | `POST /auth/signup`, `/verify-otp`, `/resend-otp`, `/signin`, `/forgot-password`, `/reset-password`, `/refresh-token`, `/logout`; `GET /auth/google`, `/google/callback`; `POST /auth/google/exchange`; `GET /auth/me`, `/devices`; `PUT /auth/profile`; `POST /auth/billing-details` |
| Keys | `GET /auth/.well-known/jwks.json` (JWKS, preferred), `GET /auth/public-key` (PEM) |
| Billing | `POST /auth/payment/order`, `/verify`, `/fail`; `GET /auth/payment/transactions` |
| Notifications | `GET /auth/notifications`, `PUT /auth/notifications/:id/read`, `GET /auth/credits/stream` (SSE); `POST /auth/notifications` is internal-only (`X-Internal-Token`) |
| Support | `POST /tickets`, `GET /tickets`, `GET /tickets/:id`, `POST /tickets/:id/reply` |
| Health | `GET /health` (liveness), `GET /health/ready` (MySQL + Redis) |

Google sign-in redirects to `FRONTEND_URL/auth/callback?code=…`; the frontend exchanges
the one-time code via `POST /auth/google/exchange` (with credentials) for an access token.

## Tokens

RS256 JWTs with `typ` (`access` / `refresh` / `reset`), `iss`, `aud` and a `kid` header.
Only access tokens are accepted by `authenticate`. Password-reset links are single-use.
Other services verify tokens with `@ai-search/shared-auth`, ideally via `JWT_JWKS_URL`.

## Database

Schema changes are migrations in `migrations/` (Umzug, bookkeeping table
`migrations_auth`). Never use `sequelize.sync()`.

```bash
npm run migrate                   # apply pending
npm run migrate -- pending        # list pending
npm run migrate -- down           # revert the last one
```

## Tests

```bash
npm test                          # unit tests, no database needed
INTEGRATION=1 npm run test:integration   # needs MySQL + Redis; DROPS the DB_NAME database
npm run lint:boundaries           # module import rules
```

Integration tests default to the database `ai_search_test` and refuse to run against a
database whose name doesn't contain "test".
