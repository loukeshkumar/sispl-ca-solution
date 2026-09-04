# SISPL CA Solution

SISPL is a practice command centre for Indian chartered accountants. The current milestone combines a responsive operational dashboard with authenticated employee management, accountable office tasks, employee attendance, controlled salary/payroll, client package entitlements, client management, Work Item 360, audited compliance workflows, secure document control, and a statutory deadline calendar.

## Data modes

The same source tree has two explicit modes:

- `demo` is the default. It uses deterministic fictitious records without requiring PostgreSQL.
- `postgres` reads the local PostgreSQL database and never falls back to demo data when configuration, connection, or queries fail.

Set local mode only in an ignored env file. Every `*:local` script reads `.env` and then `.env.local`, either of which may be absent, so a host keeping a single `.env` needs no renaming and a developer's `.env.local` overrides it:

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

In PostgreSQL mode the dashboard requires a database-backed login. The local seed creates the administrator account documented in `LOCAL_SETUP.md`; demo mode remains an unauthenticated fictitious-data preview.

## Validation

```bash
npm run test:unit
npm run test:integration
npm run build
npm run lint
```

A change that adds a module or alters a workflow must update the in-product manual (`app/manual/`) in the same commit. `test:unit` enforces the mechanical part — every sidebar destination, routed page, and typed workflow state must be documented — and [AGENTS.md](AGENTS.md) states the rule in full.

To stand up a demonstration host from an empty database, `npm run db:sample` runs migrate, seed and check, then loads demonstration history — a closed attendance month carried through to a paid payroll run, invoices, documents, timesheets and registers. It writes a fictitious firm into whatever `DATABASE_URL` points at, so it is not the command to run against a real firm's data; `db:setup:local` alone gives masters and nothing invented.

`test:integration` requires `.env` or `.env.local` and drops and recreates an isolated database ending in `_test` on every run, so back-to-back runs are repeatable; it never runs lifecycle mutations against the development database. It checks connectivity, repeated seeding, concurrent authentication throttles, composite tenant constraints, employee access provisioning, task ownership/state transitions, attendance locking, payroll approval/publication/payment, payslip privacy, and complete audited client, compliance-work, and document lifecycles.

## Architecture

- `app/page.tsx` — asynchronous server boundary and strict PostgreSQL error handling
- `app/dashboard-client.tsx` — navigation, searches, filters, client selection, and mobile menu
- `app/clients/` — permission-protected create, Client 360, edit, and archive workflows
- `lib/clients/` — client validation and tenant-scoped transactional write repository
- `app/work/` — permission-protected create, Work Item 360, edit, and completion workflows
- `lib/work/` — deadline, assignment, status, and separation-of-duties validation with tenant-scoped writes
- `app/documents/` — protected request, upload, cancellation, and authenticated download routes
- `lib/documents/` — validation, tenant-scoped persistence, and opaque document storage behind a driver seam (`SISPL_DOCUMENT_STORAGE=local|s3`) with dependency-free AWS Signature Version 4 signing for private S3-compatible buckets
- `app/attendance/` and `lib/attendance/` — employee clocking, requests, approvals, monthly controls, immutable events, and locked payroll summaries
- `app/salary/` and `lib/payroll/` — effective-dated salary structures, attendance-linked payroll, maker-checker transitions, private payslips, and CSV export
- `app/packages/`, `app/client-packages/`, and `lib/packages/` — service catalogue, package composition, effective-dated client assignments, add-ons, and entitlement enforcement
- `app/settings/attendance/` and `lib/attendance-masters/` — leave type, holiday calendar, and shift type masters consumed by the attendance workspace
- `app/settings/master-data/` and `lib/master-data/` — the documents-needed master: standard client documents defined once, then picked when raising a request so titles, instructions, and lead times stay consistent
- `lib/insights/` — deterministic practice signals over delivery, receivables, client health, team effort, and the registers; every signal cites the evidence that produced it
- `lib/statutory/` — versioned, effective-dated EPF, ESI, and professional-tax rate sets with pure calculators that suggest payroll deductions for firm review
- `lib/integrations/` — Tally XML export (masters and sales vouchers) and the filing-status provider seam
- `lib/filings/` — portal filing acknowledgements (ARN, filed date, portal status) recorded against obligations as evidence
- `app/registers/` and `lib/registers/` — UDIN register, DSC custody register with a movement trail, and statutory notice management with response deadlines
- `app/timesheets/` and `lib/timesheets/` — time entries against clients, obligations, and tasks, with per-engagement effort review
- `app/manual/` and `lib/manual/` — the operating manual inside the product: 29 chapters covering every workflow, open to every signed-in role. Its permission tables render from `permissionDefinitions` and `lib/dashboard/navigation`, so the manual cannot describe a rule the server no longer enforces
- `app/portal/` and `lib/portal/` — the client portal: a separate low-privilege authentication boundary where a client contact sees their own compliance status, document requests, and invoices, and uploads requested files
- `app/billing/` and `lib/billing/` — permission-protected draft invoices, issue/payment/cancellation lifecycle, and receivables register
- `lib/notifications/` — dedupe-keyed in-app notifications, delivery outbox, and dispatch transports: a log-only default, an HTTP email sender, and the WhatsApp Business Cloud API
- `proxy.ts` and `lib/auth/route-policy.ts` — deny-by-default routing so a page added without a permission gate is never silently public (Next.js 16 renamed the `middleware` convention to `proxy`)
- `lib/compliance/` — versioned per-tenant compliance schedules and entitlement-driven recurring work-item generation
- `scripts/jobs/` — `jobs:recurrence:local` and `jobs:notifications:local` (or `jobs:daily:local` for both) generate upcoming obligations and deadline alerts idempotently
- `lib/dashboard/` — serializable data contract, fixture provider, configuration, and mapper
- `lib/dashboard/postgres/` — Node-only pool, provider, and tenant-scoped repository
- `db/schema.ts` — canonical PostgreSQL Drizzle schema
- `drizzle/` — reviewed generated migrations
- `scripts/db/` — migration, idempotent seed, and redacted connection check

## Security boundaries

- Every tenant-owned query takes and applies an explicit tenant id.
- PostgreSQL dashboard access requires an active user, active tenant membership, valid role permission, and an unexpired server-side session.
- Routing is deny-by-default: `proxy.ts` classifies every path as public, staff, or portal and redirects anonymous requests before the page runs. It checks cookie shape only and never queries the database. Per-page `requirePermission` and `requirePortalSession` remain the authority — Next.js routes Server Functions as POSTs to the page they live on, so proxy coverage can shift when a route moves and must never be the only gate.
- Legacy role permissions resolve from one exported map, so session resolution and `hasPermission` cannot diverge.
- Outbound delivery is off by default. `SISPL_EMAIL_TRANSPORT=http` and `SISPL_WHATSAPP_TRANSPORT=cloud_api` enable real sending; a misconfigured environment degrades to recording alerts without sending them, and provider error bodies are redacted before they reach a log.
- Session cookies are HTTP-only, same-site, time-limited, and contain only a random opaque token; only its SHA-256 hash is stored.
- PostgreSQL mode does not silently substitute demo records.
- Supporting panels bolted onto a workspace (document checklist, statutory suggestions, portal contacts, filing acknowledgements, bank details) load through `loadOptionalPanel` and degrade to an empty state if they fail, so an enhancement can never block the workflow it decorates. Only a page's own primary data is allowed to throw. Panel failures log the panel name and error type, never the query or its parameters.
- Seeded PAN values are fictitious and masked; GST registrations have non-statutory internal keys only.
- Client writes reject complete PAN values, validate tenant-owned relationship owners, and create audit events.
- Work-item writes validate active tenant clients and members, enforce deadline order, and create audit events.
- Document files require matching extensions, MIME types, and byte signatures; are limited to 10 MB; are promoted from private staging storage; and are downloaded as attachments only after document-read authorization and tenant-scoped authentication. Object-storage keys are tenant-scoped and reference-validated before any request; buckets must stay private, since files are always streamed through the authenticated download route rather than a public or pre-signed URL.
- Login protection combines atomic account lockout with database-backed network and global request limits; proxy client-address headers are trusted only when explicitly configured.
- Client portal accounts are a separate identity store with their own credentials, sessions, and cookie. A portal token can never open a staff session and a staff token can never open a portal session; every portal query is scoped to both the tenant and the single legal entity the contact belongs to. Provisioning issues a one-time password, revokes prior sessions, and forces a password change; revoking access ends live sessions immediately.
- Real PAN, GSTIN, Aadhaar, banking data, portal passwords, OTPs, DSC keys, and database credentials must never be committed or logged.
- Employee, office-task, attendance, leave-request, salary/payroll, package-entitlement, client, work-item, document, calendar, in-app notification, recurring-obligation, invoice/receivables, UDIN, DSC custody, statutory notice, and timesheet workflows are implemented. The UDIN register records numbers generated on the ICAI portal; it does not generate or validate them with ICAI. The DSC register records custody and expiry only — PINs, passwords, and private keys are rejected by validation and must never be entered. Timesheets record effort for review; they do not price engagements or post to billing. Filing acknowledgements are entered by the firm from the portal; SISPL does not connect to GSTN, the income-tax portal, TRACES, or MCA, and the status resolver reports `unavailable` rather than inventing a status until a licensed provider is configured. Tally export produces import-ready XML; there is no live Tally connection and no import back into SISPL. Document OCR and AI extraction are not implemented. **Insights** are deterministic rules recomputed on load, not predictions or model output; there is no LLM in the product, and no natural-language query layer. Seeded compliance schedules are firm-reviewable defaults, not statutory advice; due dates and invoice tax amounts are entered and verified by the firm. Automatic statutory PF/ESI/PT/TDS or GST calculation and filing, bank disbursement, biometrics/GPS, outbound email/WhatsApp delivery (a log-only transport is wired), payment collection, and external communications are not implemented.

## Employee and task management

- `app/team/` and `lib/team/` provide Employee 360, profile administration, secure access provisioning, and workload visibility.
- **Settings → User Roles Management** provides tenant-scoped access governance. Super Admin is a sealed full-access class; only Super Admin can create delegated Admin roles or assign Admin accounts. Every Employee is assigned exactly one reusable Employee category, with no one-off permission overrides.
- Role permissions are evaluated on the server for every protected request. Updating a role increments its authorization version, writes an audit event, and revokes every affected active session so reductions apply on the next request.
- `app/tasks/` and `lib/tasks/` provide Task 360, tenant-scoped assignment, employee status updates, review, and audited closure.
- Team administration is limited to firm administrators and partners. Managers can read the directory and assign tasks. Associates can access and update only their own tasks.
- Provisioning creates a one-time random password, revokes previous sessions, and forces a permanent password change before workspace access.
- Office tasks enforce tenant-owned assignees, reviewer separation, valid client/work context, atomic closure transitions, and lifecycle audit events.

## Attendance and salary/payroll

- **Attendance** gives employees check-in/out, monthly records, leave/correction requests, and request history. Managers see only reportee approvals; administrators and partners control the tenant register and month lock.
- **Salary** gives employees only their own published payslips. Administrators and partners manage confidential effective-dated structures and monthly payroll; managers receive no salary amounts.
- Payroll consumes an immutable locked attendance summary and follows `draft -> submitted -> approved_locked -> payslips_published -> paid`.
- **Bank disbursement** produces a generic NEFT/RTGS instruction CSV once a run is approved and locked, requires the same authority as approving payroll, and records every generated batch for audit. Held employees, nil net pay, and employees without payment instructions are reported as stated exclusions rather than silently skipped. SISPL never connects to a bank and never initiates a payment; money moves only when someone uploads and authorises the file at the bank.
- Employee account numbers are stored because a bank file needs them, are masked to the last four digits everywhere they are displayed, and are never written to a log or an audit reason. Replacing instructions retires the previous account instead of editing it.
- INR values are stored as integer paise. PF, ESI, and professional tax are **suggested** from effective-dated rate versions and must be reviewed; income tax/TDS remains entirely manual. Every rate, ceiling, threshold, and rounding rule is a stored parameter, so a historic run recomputes with the rules that were in force. Seeded rates are firm-reviewable defaults carrying a source reference the firm replaces after verifying the governing notification. A rule with no configured version is reported as missing rather than treated as nil, and the product does not claim automatic statutory compliance.

## Client service packages

- **Settings → Attendance Masters** holds the three masters the attendance workspace runs on. **Leave types** are firm-defined (code, paid-by-default, half-day allowance, annual quota) and drive the leave request form; the six previously fixed codes are seeded so historic requests stay valid. **Holidays** are dated per state, and active *public* holidays are removed from scheduled working days when a month is prepared and when it is locked, so nobody is marked absent on a firm closure. **Shift types** define timings, working week, full/half-day minutes, and late grace; exactly one may be the firm default, and an employee with no shift falls back to the tenant attendance policy. Records can be edited in place to correct a name, date, or timing; archiving is reserved for retiring a record and keeps it in history. Locked months are never recalculated, so an edit only affects periods prepared afterwards.
- **Settings → Master Data** holds the documents-needed checklist: each entry carries a code, name, category, standard instructions, an optional service link, a lead time, and whether it is usually mandatory. Raising a document request offers the active entries and fills the title, instructions, and due date from the one chosen; free text remains available. Archiving keeps history and only removes the entry from future requests, and requests already raised keep their original wording.
- **Settings → Service Management** is the tenant-wide service master. Administrators and partners create, edit, or archive services; managers receive read-only access. Active master services flow into package, client, and compliance-work selectors.
- **Package Setup** composes monthly, quarterly, annual, or one-time packages from the active service master without duplicating service records.
- **Client Packages** lets administrators, partners, and managers assign one effective base package per legal entity, add optional services, replace a current assignment, schedule a future assignment, and cancel an agreement with a reason. Associates have no package access.
- Every assignment stores an immutable snapshot of the package name, billing cycle, fee, and included/add-on services so later catalogue edits do not rewrite commercial history.
- Work creation is restricted to services entitled by the client’s effective package. Existing obligations remain editable when a new package changes future entitlements.
- Package management records service entitlements and agreed pricing; it does not create invoices, post accounting entries, collect payment, or replace a billing module.
