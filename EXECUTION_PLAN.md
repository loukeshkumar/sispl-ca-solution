# SISPL CA_SOLUTION — Execution Plan

## Goal

Build a secure multi-firm SaaS for Indian CA practices. Each tenant receives isolated client, compliance, document, work, billing and audit data.

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
