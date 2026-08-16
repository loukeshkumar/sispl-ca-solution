# Client Packages Design

**Approved:** 2026-08-16

## Goal

Add a tenant-isolated client package system for a CA practice. Authorized users can maintain a reusable service catalogue and package catalogue, then assign one effective base package plus optional add-on services to each client legal entity.

## Approved decisions

- The application exposes two persistent workspace menus: **Package Setup** and **Client Packages**.
- A legal entity may have one active base package at a time.
- A client assignment may include optional add-on services that are not already part of the base package.
- Packages support monthly, quarterly, annual, and one-time billing cycles.
- Every assignment snapshots its package name, agreed fee, billing cycle, and services. Later catalogue edits never rewrite an existing agreement.
- This module defines service entitlement and commercial terms. It does not create invoices, collect payments, or calculate tax.

## Roles and permissions

- `packages:read`: firm administrator, partner, and manager.
- `packages:manage`: firm administrator and partner.
- `client_packages:manage`: firm administrator, partner, and manager.
- Associates cannot see or access either workspace.
- Every repository query and Server Action is scoped by the authenticated tenant. Route authorization is enforced server-side and is never delegated to hidden UI controls.

## Domain model

### Service catalogue

`service_catalog` stores a tenant-owned service code, name, category, description, status, and timestamps. Service codes are unique within a tenant and remain stable after creation. A used service can be archived but not hard-deleted. Existing GST, TDS, ITR, Audit, ROC, LUT, Books, and 10B services are seeded.

### Package catalogue

`service_packages` stores a tenant-owned package code, name, description, billing cycle, standard fee in integer paise, status, and timestamps. `service_package_items` joins packages to included services with composite same-tenant foreign keys. Every active package includes at least one active service. Editing catalogue data affects only future assignments.

### Client assignments

`client_package_assignments` stores the legal entity, source package, effective dates, status, package code/name snapshots, billing-cycle snapshot, standard-fee snapshot, agreed-fee snapshot, and timestamps. Status values are `scheduled`, `active`, `ended`, and `cancelled`.

`client_package_assignment_services` stores each package or add-on service snapshot, including the original catalogue identifier, service code, service name, category, and source (`package` or `addon`). A service may occur only once within an assignment.

All tables include tenant-aware unique keys, indexes, checks, and composite foreign keys. Assignment creation or replacement runs in one database transaction. It locks the legal entity's current assignments, rejects overlapping effective ranges, ends the replaced assignment when appropriate, persists the snapshots, and synchronizes the legal entity's active `client_services` entitlement. Existing manually selected services remain available until the first package assignment.

## Business rules

- Client assignment date ranges cannot overlap for the same legal entity.
- The start date is required; the optional end date cannot precede it.
- A package must be active when assigned.
- Add-ons must be active catalogue services and cannot duplicate package services.
- The agreed fee defaults to the package fee but may be overridden with a non-negative INR amount.
- Money conversion is exact and persisted as integer paise.
- Cancelling or ending an assignment preserves its snapshots and history.
- Replacing an active assignment requires explicit confirmation and never mutates the previous assignment.
- Client work can be created only for an active entitled service. Legacy clients without an assignment continue using existing active `client_services` until assigned.

## Application architecture

The feature follows the application's current App Router boundaries:

- `lib/packages/validation.ts` owns pure input normalization and business validation.
- `lib/packages/repository.ts` owns tenant-scoped catalogue and assignment persistence and view models.
- `app/packages/actions.ts` owns authorized Server Actions.
- `app/dashboard/package-setup-workspace.tsx` renders service and package catalogue management.
- `app/dashboard/client-packages-workspace.tsx` renders metrics, filtering, assignment history, and package assignment controls.
- Dedicated create/edit/detail routes inherit `AuthenticatedWorkspaceShell`, preserving the sidebar and top command bar.

The dashboard page loads package data only when either package workspace is selected. Demo mode returns an empty, truthful workspace instead of invented commercial data.

## User experience

### Package Setup

The workspace contains Services and Packages tabs, compact KPI cards, searchable catalogue registers, status filters, clear empty states, and primary create actions. Desktop registers become structured mobile cards. Package forms show selected service count, standard fee, billing cycle, and an accessible included-service selector.

### Client Packages

The workspace contains active-package, upcoming-renewal, unassigned-client, and recurring-value KPIs. Search and filters cover client, package, billing cycle, and assignment status. Each register entry shows client/legal entity, package, included and add-on counts, agreed fee, billing cycle, effective dates, and status. Assignment forms preview included services, prevent duplicate add-ons, warn before replacement, and show field-level validation.

### Visual system

Both workspaces reuse the approved premium glass token contract in light and dark modes: frosted surfaces, restrained teal accents, Geist typography, Lucide icons, 44-pixel interaction targets, visible focus indicators, and 150–300 ms reduced-motion-aware transitions. Content remains readable and free of horizontal scrolling at 375, 768, 1024, and 1440 pixel widths.

## Failure handling

- Validation failures return field-specific messages without losing non-sensitive form input.
- Unique or overlap conflicts return a clear assignment conflict instead of a database error.
- Unauthorized reads redirect to `/forbidden`; unauthorized actions never mutate state.
- Archived services and packages remain readable in historical snapshots but cannot be selected for new assignments.
- Database exceptions are logged only by error type and return a generic user-facing message.

## Verification

Test-first coverage will verify schema constraints, permissions, money parsing, package validation, assignment snapshots, overlap rejection, add-on deduplication, tenant scoping, entitlement synchronization, route authorization, workspace navigation, responsive UI contracts, and the PostgreSQL assignment lifecycle. Final verification includes the complete unit suite, integration suite when the isolated test database is available, ESLint, TypeScript, production build, and `git diff --check`.

## Scope exclusions

- Invoice generation and payment collection
- Automatic GST calculation
- Proration, usage-based billing, discounts, and coupons
- Client self-service purchase flows
- Automatic work-item generation from a package
