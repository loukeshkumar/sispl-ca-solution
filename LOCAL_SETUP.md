# SISPL CA Solution — Local PostgreSQL Setup

## Prerequisites

- Node.js 22.13 or newer
- npm
- PostgreSQL 16 or newer
- A PostgreSQL role allowed to create tables in the selected database

Standard Next.js commands work in PowerShell, Command Prompt, macOS, Linux, and WSL.

## 1. Install dependencies

```bash
npm ci
```

## 2. Create the local database

Create an empty database named `sispl_ca_solution`. For example, from `psql` while connected as an administrative role:

```sql
create database sispl_ca_solution;
```

## 3. Configure the ignored local environment

Copy `.env.example` to `.env.local` and replace only the placeholders:

```dotenv
SISPL_DATA_SOURCE=postgres
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/sispl_ca_solution?connection_limit=30&pool_timeout=30
```

Do not commit `.env.local`. If the password contains URL-reserved characters, percent-encode it in the URL.

## 4. Migrate, seed, and check

```bash
npm run db:setup:local
```

This applies the reviewed Drizzle migration, idempotently seeds one fictitious firm with five clients and four work items, and reports only the host, port, database name, PostgreSQL version, and required-table status. Re-running it does not duplicate seed rows.

The steps are also available separately:

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:check:local
```

## 5. Start the local application

```bash
npm run dev
```

The dashboard badge reads `LOCAL DATABASE` in PostgreSQL mode. If the connection is unavailable, the app shows a safe retry screen and does not substitute demonstration data.

## Tests and production build

```bash
npm run test:unit
npm run test:integration
npm run build
npm run start
```

The integration suite executes a basic query, seeds twice, checks stable row counts, loads the seeded dashboard, and verifies that a different tenant id cannot see seeded client or work rows.

## Demonstration mode

Remove `SISPL_DATA_SOURCE` or set it to `demo` to use deterministic representative data without PostgreSQL.

## Troubleshooting

- `DATABASE_URL is required`: create `.env.local` from `.env.example`.
- Database unavailable screen: confirm PostgreSQL is running, the host/port is reachable, and the role can access `sispl_ca_solution`; then run `npm run db:check:local`.
- Missing tables: run `npm run db:migrate:local`, then the check again.
