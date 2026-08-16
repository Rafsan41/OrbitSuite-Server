# OrbitSuite — API

Multi-tenant SaaS subscription platform. Express 5, Prisma 7, PostgreSQL, Stripe.

Organizations sign up, pay for a plan through Stripe Checkout, and get access to
the product. Three roles — Platform Admin, Organization Admin, Member — see
strictly different slices of the data, and no tenant can reach another's rows.

The Next.js client lives in a separate repository, `orbitsuite-client`.

---

## Running it

Requires Node 20+ and a PostgreSQL database.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` — `DATABASE_URL` and the two JWT secrets are the only ones needed
to boot. Stripe and SMTP are optional; the modules that use them assert their own
variables at the point of use, so the server starts without them and only
checkout and email fail.

```bash
npx prisma migrate dev
```

```bash
npm run seed
```

```bash
npm run dev
```

The API listens on `http://localhost:5000`, with every route under `/api/v1`.
`GET /` is a health check that confirms the database connection.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode via tsx |
| `npm run build` | `prisma generate` then `tsc` |
| `npm run build:vercel` | Bundles the app to `dist-vercel/` for the serverless function |
| `npm start` | Run the compiled output in `dist/` |
| `npm run seed` | Reset and repopulate the demo data |
| `npm test` | Vitest — 67 tests against a real database |
| `npm run lint` | ESLint over `src/` |

---

## Test credentials

Created by `npm run seed`. Every account uses the same password:

**`Password123!`**

| Role | Email | Organization |
| --- | --- | --- |
| Platform Admin | `platform.admin@orbitsuite.test` | OrbitSuite Platform |
| Organization Admin | `admin@acme.test` | Acme Corp |
| Member | `member@acme.test` | Acme Corp |
| Organization Admin | `admin@globex.test` | Globex Inc |
| Member | `member@globex.test` | Globex Inc |

Two fully populated tenants exist on purpose: proving isolation needs a second
organization whose data must never appear in the first one's responses.

Re-seeding is destructive and invalidates every session — the user rows are
deleted and recreated with new ids. In development the Platform Admin can
trigger it from the client's overview page, which signs itself out afterwards.

---

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | yes | 32+ characters |
| `JWT_REFRESH_SECRET` | yes | 32+ characters, **different** from the access secret |
| `JWT_ACCESS_EXPIRES_IN` | | Default `15m` |
| `JWT_REFRESH_EXPIRES_IN` | | Default `7d` |
| `STRIPE_SECRET_KEY` | for checkout | Test mode |
| `STRIPE_WEBHOOK_SECRET` | for webhooks | From `stripe listen` |
| `SMTP_*` | for email | Any SMTP provider; Mailtrap works |
| `CLIENT_URL` | | Default `http://localhost:3000`; used for CORS and Stripe redirects |
| `PORT` | | Default `5000` |

Configuration is validated by zod at boot (`src/app/config/env.ts`), so a missing
or malformed variable fails immediately with a readable message rather than
surfacing as `undefined` inside a Stripe call much later.

---

## Stripe webhooks

Checkout cannot complete locally without forwarding webhooks, because **payment
is confirmed by the webhook and nothing else**:

```bash
stripe listen --forward-to localhost:5000/api/v1/webhooks/stripe
```

Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` and restart.

The webhook route is mounted in `src/app.ts` *above* `express.json()`, because
signature verification needs the raw request body — parsing it first would make
every signature check fail.

---

## How it works

### Tenant isolation

Every tenant-facing route runs behind `withTenantScope`, which installs a Prisma
client extension that injects `organizationId` into every query for the current
request. Handlers never write an `organizationId` filter themselves.

That matters because the alternative — remembering the filter at each call site —
fails the first time someone forgets. Here, forgetting is not possible: a
`findMany` with no filter returns only the caller's rows, a `findUnique` by
primary key cannot reach another tenant's record, a `deleteMany` with no `where`
cannot wipe anyone else, and a `create` carrying a forged `organizationId` has it
overwritten with the caller's own.

Platform Admin routes deliberately bypass this and use an unscoped client —
crossing tenants is the entire purpose of that role — so those routes carry their
own `requireRole` gate.

See `tests/tenant-isolation.test.ts` (11 cases).

### Authentication

A 15-minute access token is returned in the response body and held in memory by
the client. The refresh token is an **httpOnly cookie** the browser attaches on
its own, so JavaScript never sees it.

Access and refresh tokens are signed with **separate secrets**, which means a
stolen refresh token cannot be replayed against protected routes, and an access
token cannot be presented at the refresh endpoint. Both directions are tested.

Every refresh re-reads the user and organization, so suspending an organization
ends its sessions within one access-token lifetime rather than letting them run
for the refresh token's seven days.

Passwords are hashed with argon2 and never leave the server in any response.

> **Known limitation.** Refresh tokens are stateless JWTs with no server-side
> store, so a used refresh token stays valid until it expires. Real rotation
> would need a `refreshTokenHash` column and a check on every refresh. What
> bounds the damage today is the status re-check described above.

### Authorization

`requireRole` gates every protected route server-side. Hiding a control in the
client is presentation, not access control — the tests send valid tokens for the
wrong role at each endpoint and assert both the denial and that nothing was
written. A member sending `role: "PLATFORM_ADMIN"` in a profile update stays a
member: the role is read from the signed token, never from the payload.

See `tests/role-authorization.test.ts` (24 cases).

### Payments

Registration is **paid onboarding, not free signup**. The organization is created
`PENDING` and stays unusable until Stripe confirms payment.

The order matters: `POST /checkout/session` creates a Stripe Checkout Session and
grants nothing. Only `checkout.session.completed`, arriving at the webhook,
activates the organization, subscription, payment and transaction — together, in
one database transaction. A browser redirect is never treated as proof of
payment, because a redirect can be forged.

The session carries `organizationId`, `subscriptionId` and `planId` in its
metadata, and the same trio is repeated on the Stripe subscription itself —
renewal invoices arrive without the originating Checkout Session, so the metadata
has to live on the long-lived object too.

See `tests/payment-flow.test.ts` (9 cases).

### Invoice PDFs

`GET /payments/:id/invoice` returns a one-page PDF carrying the organization
name, plan, billing period, amount, payment date and invoice number.

The invoice number is derived from the payment id — `INV-<year>-<first eight
characters, uppercased>` — so it is stable and unique without a separate
sequence to keep. It is computed in one place and used by both the JSON views
and the PDF, because two copies of that formula would eventually disagree about
a number printed on a document a customer keeps.

Rendered with **pdfkit**, not a headless browser. The layout is a fixed single
page with no reflow, so the one thing a browser would buy — real CSS layout —
buys nothing, while Chromium would add roughly 180MB to every install and a
browser launch to every request.

Nothing is stored: the buffer is built in memory per request. Invoices are
derived entirely from data already held, so a saved copy would only be a second
thing to keep in sync.

This route is the one endpoint that does not return the standard envelope — its
body is the file. Errors still do, because they are thrown before anything is
written and the global handler formats them.

### Webhook idempotency and rollback

Stripe retries. A replayed event must not charge, activate or record anything
twice.

Before any real work, the handler inserts the Stripe event id into
`processed_webhook_events`, whose primary key is that id. A duplicate delivery
violates the unique constraint and is skipped. The insert happens **inside** the
same transaction as the business writes, so if a later step throws, the marker
rolls back with everything else and a genuine retry can still succeed — a marker
committed separately would permanently swallow the event.

See `tests/webhook-idempotency.test.ts` (5 cases, covering both the duplicate
path and rollback-then-retry).

---

## Tests

```bash
npm test
```

67 tests across 5 files, run against a real database rather than mocks — the
tenant extension and the transaction semantics are precisely the things a mock
would fake away. Files run serially (`fileParallelism: false`) so fixtures cannot
clobber each other.

| File | Covers |
| --- | --- |
| `tenant-isolation.test.ts` | Cross-tenant reads, writes, aggregates and forged ids |
| `authentication.test.ts` | Credentials, token forgery, refresh, suspension |
| `role-authorization.test.ts` | Every role against every gated route, both directions |
| `payment-flow.test.ts` | Checkout guards and the webhook metadata contract |
| `webhook-idempotency.test.ts` | Duplicate delivery and transactional rollback |

Stripe is mocked in `payment-flow.test.ts` and the webhook tests: the guards, the
metadata and the transaction boundaries are ours and worth testing; Stripe's SDK
is not.

The rate limiters disengage under `NODE_ENV=test` (`src/app/middlewares/rate-limit.ts`).
They key on IP, and one test run would otherwise exhaust the ten-attempt budget
partway through, failing later cases on 429s that prove nothing. Development and
production keep the full guard.

---

## API

All routes are under `/api/v1`. A Postman collection is in
[`docs/`](docs/OrbitSuite.postman_collection.json).

| Prefix | Purpose |
| --- | --- |
| `/auth` | Register, login, refresh, logout, password reset, change password |
| `/checkout` | Create a Stripe Checkout Session, poll payment status |
| `/webhooks/stripe` | Stripe events — mounted above the JSON body parser |
| `/plans` | Plan catalogue; public reads, Platform Admin writes |
| `/organizations` | Tenant profile; Platform Admin listing, suspend, reactivate |
| `/users` | Members, invitations, own profile |
| `/subscriptions` | Current subscription, plan changes, cancellation, expiry sweep |
| `/payments` | Billing history, invoice detail, and invoice PDF — Org Admin only |
| `/transactions` | Own ledger, plus a platform-wide view for Platform Admin |
| `/stats` | Platform-wide totals — Platform Admin only |

`/dev/seed` also exists, but only when `NODE_ENV=development`. It is not
registered otherwise, guards `NODE_ENV` again inside its own router, and still
requires an authenticated Platform Admin.

---

## Deploying to Vercel

`api/index.ts` exports the Express app as a serverless function, and
`vercel.json` rewrites every path to it so the existing router keeps owning
routing. `npm run build:vercel` bundles the app with tsup into a single file
first — `moduleResolution: NodeNext` gives every relative import a `.js` suffix
that points at a `.ts` file, and one pre-bundled file removes that question for
the platform bundler.

Set `DATABASE_URL`, both JWT secrets, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `CLIENT_URL` and `NODE_ENV=production` in the project's
environment variables. Migrations and the seed run from a developer machine
against the production database — Vercel has no shell:

```bash
DATABASE_URL="<production-url>" npx prisma migrate deploy
```

Then point a Stripe webhook endpoint at
`https://<deployment>/api/v1/webhooks/stripe`.

Two things behave differently once deployed, and both are deliberate to record
rather than discover:

- **Rate limiting weakens.** `express-rate-limit` keeps its counters in memory,
  and each serverless instance has its own. Real protection across instances
  needs a shared store such as Redis.
- **Webhook signatures depend on the raw body.** The route is mounted above
  `express.json()` locally, but a platform that parses the body before Express
  sees it would break every signature check. If webhooks fail after a deploy
  with signature errors, that is the first thing to look at.

## Project layout

```
src/
  app.ts                    Express app, middleware order, error handling
  server.ts                 Boot
  app/
    config/env.ts           zod-validated environment
    lib/                    Prisma clients (scoped + unscoped), Stripe, seed
    middlewares/            requireAuth, requireRole, withTenantScope, rate limits
    modules/<feature>/      route → controller → service → validation
    routers/index.ts        One place where every module is mounted
    utils/                  JWT, password hashing, pagination, AppError
prisma/schema.prisma        Data model
tests/                      Integration tests
```

Each module is four files — route, controller, service, validation. Controllers
stay thin: they parse the request and shape the response, and never touch the
database directly. Adding a feature means adding one row to
`src/app/routers/index.ts`; `app.ts` never changes.

Every endpoint returns the same envelope, success or failure:

```json
{ "success": true, "message": "...", "data": {}, "meta": {} }
```
