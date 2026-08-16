# SISPL CA Solution

SISPL is a read-only practice command centre for Indian chartered accountants. The current milestone brings client health, services, registrations, priority work, deadlines, ownership, and compliance signals into one responsive dashboard.

## Data modes

The same source tree has two explicit modes:

- `demo` is the default. It uses deterministic fictitious records without requiring PostgreSQL.
- `postgres` reads the local PostgreSQL database and never falls back to demo data when configuration, connection, or queries fail.

Set local mode only in ignored `.env.local`:

```dotenv
SISPL_DATA_SOURCE=postgres
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/sispl_ca_solution?connection_limit=30&pool_timeout=30
```

The URL parser removes `connection_limit` and `pool_timeout` before handing the connection string to `pg`, then applies them as pool settings. Credentials and connection strings are never logged.

## Local PostgreSQL start

Requirements: Node.js 22.13 or newer and PostgreSQL 16 or newer.

```bash
npm ci
cp .env.example .env.local
npm run db:setup:local
npm run dev
```

Open the URL printed by Next.js. See [LOCAL_SETUP.md](LOCAL_SETUP.md) for Windows, migration, testing, and troubleshooting details.

## Validation

```bash
npm run test:unit
npm run test:integration
npm run build
npm run lint
```

`test:integration` requires `.env.local` and a migrated PostgreSQL database. It checks connectivity, repeated seeding, expected dashboard counts, and tenant isolation.

## Architecture

- `app/page.tsx` — asynchronous server boundary and strict PostgreSQL error handling
- `app/dashboard-client.tsx` — navigation, searches, filters, client selection, and mobile menu
- `lib/dashboard/` — serializable data contract, fixture provider, configuration, and mapper
- `lib/dashboard/postgres/` — Node-only pool, provider, and tenant-scoped repository
- `db/schema.ts` — canonical PostgreSQL Drizzle schema
- `drizzle/` — reviewed generated migrations
- `scripts/db/` — migration, idempotent seed, and redacted connection check

## Security boundaries

- Every tenant-owned query takes and applies an explicit tenant id.
- PostgreSQL mode does not silently substitute demo records.
- Seeded PAN values are fictitious and masked; GST registrations have non-statutory internal keys only.
- Real PAN, GSTIN, Aadhaar, banking data, portal passwords, OTPs, DSC keys, and database credentials must never be committed or logged.
- The application UI is read-only in this milestone. Production authentication, RBAC enforcement, writes, and external communications are not implemented.
