# SISPL CA_SOLUTION — Execution Plan

## Goal

Build a secure multi-firm SaaS for Indian CA practices. Each tenant receives isolated client, compliance, document, work, billing and audit data.

## Current implementation checkpoint (16 August 2026)

This file is the product roadmap, not a statement that every milestone is complete. The local application currently delivers:

- Milestones 1 and 2 as working vertical slices: responsive workspace shell, PostgreSQL tenancy, authentication, RBAC, sessions, audit events, migrations, and isolated integration tests.
- Milestone 3 as a focused client lifecycle: create, edit, Client 360, guarded archive, services, registrations, ownership, and portfolio health.
- Partial Milestones 4, 5, and 6: manually managed compliance work, employee profiles and access provisioning, general/client/compliance-linked office tasks, attendance and leave controls, salary/payroll control, client service packages, assignment and self-service task states, completion, calendar, document requests, validated private uploads, and authenticated downloads.

Still planned: template/rule versioning, task dependencies, document versions/evidence chains, statutory-domain engines, production object storage, and external integrations. These must not be presented as implemented capabilities. Compliance recurrence (`lib/compliance/recurrence.ts`, 45-day lookahead) and notification dispatch (`lib/notifications/`) now ship and run from `npm run jobs:daily:local`.

**Settings → Service Management** maintains the tenant-wide service master. **Package Setup** builds reusable package definitions from that master, and **Client Packages** assigns one effective base package plus optional add-ons to each legal entity. Each assignment stores an immutable snapshot of commercial terms and services; package management does not create invoices or replace the planned billing milestone.

**Settings → User Roles Management** separates access into one sealed, tenant-scoped Super Admin class, Super Admin-created delegated Admin roles, and reusable Employee-category roles. Permission changes are audited and revoke affected sessions; Employee Management can assign Admin roles only when the actor is Super Admin.

## Technology target

- Next.js App Router, React, TypeScript and Tailwind CSS
- PostgreSQL with Drizzle ORM and reviewed SQL migrations
- Private object storage for documents and Redis-backed jobs
- Server-side authentication, tenant membership and RBAC

The first hosted checkpoint uses representative data. Live PostgreSQL tenancy and public authentication begin in Milestone 1 after the production runtime/provider is selected.

## Milestones

1. Product shell: responsive partner dashboard, multi-firm selector, risk queue, compliance health and workload.
2. Platform: PostgreSQL, tenant/branch/user/membership/RBAC, sessions, audit events and tests.
3. Client: group, entity, identifiers, contacts, registrations, engagement and Client 360.
4. Work: versioned templates, recurrence, tasks, dependencies, review, escalation and calendar.
5. Documents: secure requests, versions, evidence links, client portal and reminders.
6. Domains: Direct Tax, GST, TDS/TCS, Audit/UDIN, ROC/LLP, accounting, payroll and advisory.

## Non-negotiable rules

- Tenant scope at every data-access boundary.
- Historic rules, forms, calculations and filings are versioned.
- Every filing/report has an evidence chain and audit trail.
- AI never releases a statutory result or external communication without authorized human approval.
