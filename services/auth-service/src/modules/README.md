# auth-service modules

`auth-service` is split into bounded-context modules. This is step 1 toward separate
services: the code is separated now, while the database, routes and deployment are unchanged.

| Module | Owns | Tables | Mounted at |
|---|---|---|---|
| `identity` | users, credentials, OTP, password reset, Google OAuth, sessions, JWT signing | `users` (except `credits`), `refresh_tokens` | `/auth` |
| `billing` | Razorpay orders/transactions, **credit balance** | `transactions`, `users.credits` | `/auth/payment` |
| `notifications` | user notifications, SSE stream (credits + notifications) | `notifications` | `/auth/notifications`, `/auth/credits/stream` |
| `support` | support tickets | `tickets` | `/tickets` |
| `agents` | agents, API keys, usage logs — **not mounted**; written by another codebase | `agents`, `agent_logs` | — |

`src/shared/` holds infrastructure only: DB/Redis/mailer config, rate limiting, the
internal-token middleware and the event bus (`shared/events.js`).

## Rules

1. **Import other modules only through their `index.js`.** `require('../billing')` is fine;
   `require('../billing/models/Transaction')` is not.
2. **`shared/` never imports a module.**
3. **Each table has one writer.** Only `billing/credits.js` writes `users.credits`; identity may read it.
4. **Prefer events over calls** for side effects in another module. Publish with
   `shared/events.js`; channel names there are a cross-service contract (`credit:update`
   is also published by other services).
5. **Refer to another module's rows by id**, not Sequelize associations across modules.

Rules 1 and 2 are checked by `npm run lint:boundaries`.

## Next steps

- Move `credits` off `users` into a billing-owned ledger table.
- Give each module its own DB user with grants only on its own tables.
- Replace Redis pub/sub with a durable bus (outbox + RabbitMQ / Redis Streams).
- Extract a module into its own service only when scaling or team ownership requires it.
