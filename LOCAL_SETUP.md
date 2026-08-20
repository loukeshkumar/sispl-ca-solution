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
SISPL_PUBLIC_URL=http://localhost:3000
AUTH_TRUST_PROXY_HEADERS=false
```

Do not commit `.env.local`. If the password contains URL-reserved characters, percent-encode it in the URL.

## 4. Migrate, seed, and check

```bash
npm run db:setup:local
```

This applies the reviewed Drizzle migrations, then idempotently seeds one fictitious firm with five clients, four compliance work items, five employee profiles, five attendance work profiles, one Bihar attendance policy, five office tasks, and a default service catalogue. No attendance history, salary values, payroll runs, payslips, package assignments, or commercial fees are fabricated by the seed. The connection check reports only the host, port, database name, PostgreSQL version, and required-table status. Re-running setup does not duplicate seed rows.

Uploaded documents are stored in `.data/documents`, which is outside `public` and ignored by Git. Back up that directory together with PostgreSQL; document metadata alone cannot restore uploaded files.

To use private object storage instead, set `SISPL_DOCUMENT_STORAGE=s3` with the `SISPL_S3_*` values from `.env.example`, then verify the credentials and a full stage/commit/read/delete round trip:

```bash
npm run storage:check:local
```

The bucket must remain private: files are always streamed through the authenticated download route, never a public or pre-signed URL. Switching modes does not migrate existing files, so move them before changing an environment that already holds uploads.

Interrupted uploads are staged and reconciled separately. Run this maintenance command after an abnormal shutdown:

```bash
npm run db:reconcile-documents:local
```

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

## Local sign-in

PostgreSQL mode requires authentication after the seed runs:

- Firm ID: `sharma-kumar-ca`
- Email: `loukesh@example.invalid`
- Development password: `SISPL-Local-2026!`

Override the development password before the first seed by setting `SISPL_DEV_ADMIN_PASSWORD` in `.env.local`. Passwords are stored only as salted scrypt hashes. Re-running the seed does not overwrite an existing credential.

The Super Admin can add employees from **Team**, configure reusable access roles from **Settings → User Roles Management**, provision a one-time temporary password from **Employee 360**, assign work from **Tasks**, manage attendance from **Attendance**, create salary structures and payroll from **Salary**, maintain the service master from **Settings → Service Management**, compose packages from **Package Setup**, and manage legal-entity agreements from **Client Packages**. Admin accounts can only be created or assigned by Super Admin. Every Employee receives one Employee-category role; changing the role definition revokes affected sessions immediately. A newly provisioned employee automatically receives a Bihar attendance work profile and must create a permanent password at first sign-in.

**My Work** opens on the viewer's own assignments, with scope tabs for work they review and for the whole firm. Filter, sort, view and scope state all live in the query string, so any view can be bookmarked or pasted to a colleague, and the preset links (My overdue, Awaiting client, Ready for my review, Over budget, Unassigned) are ordinary shareable URLs. Rows show the internal due date the firm manages to alongside the statutory one, an outstanding-items count, and logged time against budget. Bulk reassignment, reviewer changes, internal-date shifts and status changes require `work:write`; the whole selection is validated first so skipped items are reported with a reason, and each changed item writes its own audit event. Bulk actions cannot mark work completed. The capacity view shows four weeks of committed effort per employee against availability derived from their configured shift, and reports how many of their items carry no budget so an empty lane reads as unknown rather than free.

Work budgets come from **Settings → Service Management**, where each service may carry a standard effort in minutes. A new work item copies that figure once, at creation. Editing the standard afterwards never rewrites the budget on work already raised, so historic budget-versus-actual stays comparable.

To prepare payroll: configure salary structures, prepare and resolve the attendance month, move it to review, lock attendance, then create the matching payroll run. Enter reviewed PF/ESI/PT/TDS values in the draft run before submission. A partner approves and locks the run; a firm administrator can use the audited same-person override only with a reason. Publishing payslips and recording payment are separate actions.

To configure client entitlements, create or review catalogue services in **Settings → Service Management**, compose a package with its billing cycle and fee in **Package Setup**, then assign it to a legal entity from **Client Packages**. Administrators and partners manage the master; managers can read it and manage client assignments; associates have no catalogue access. Active services are fetched from the same tenant master in package, direct-client, and compliance-work forms. One base package may be effective at a time; optional add-ons extend it. The assignment keeps an immutable snapshot of the agreed package and service set, and INR amounts are stored as integer paise. This feature controls service entitlement and agreed pricing; it does not create invoices or collect payment.

## Tests and production build

```bash
npm run test:unit
npm run test:integration
npm run build
npm run start
```

The integration suite derives or uses a separate database whose name must end in `_test`, migrates and seeds it, then exercises authentication concurrency, composite tenant constraints, employee access, office-task state transitions, attendance-to-payroll locking, maker-checker approval, payslip privacy, package assignment history, and temporary client, work-item, and document lifecycles. By default `sispl_ca_solution` becomes `sispl_ca_solution_test`. Set `DATABASE_URL_TEST` only when a different isolated `_test` database is required; the configured PostgreSQL role must be allowed to create it on first run.

`AUTH_TRUST_PROXY_HEADERS` must remain `false` for direct local development. Enable it only behind a trusted reverse proxy that overwrites `X-Real-IP`/`X-Forwarded-For`. Login throttling always includes a database-backed global limit.

## Demonstration mode

Remove `SISPL_DATA_SOURCE` or set it to `demo` to use deterministic representative data without PostgreSQL.

## Troubleshooting

- `DATABASE_URL is required`: create `.env.local` from `.env.example`.
- Database unavailable screen: confirm PostgreSQL is running, the host/port is reachable, and the role can access `sispl_ca_solution`; then run `npm run db:check:local`.
- Missing tables: run `npm run db:migrate:local`, then the check again.
