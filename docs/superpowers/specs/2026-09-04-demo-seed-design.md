# Demo seed: transactional history for the seeded firm

Date: 2026-09-04
Status: approved for planning

## Problem

`scripts/db/seed.ts` populates 37 of the 86 tables. Everything it creates is
masters and configuration: roles and permissions, the service catalogue, five
clients, six employees, salary structures, statutory rate versions, shift types,
leave types, attendance policies, and four compliance work items.

It creates no transactional history. These tables stay empty:

```
attendanceDays, attendancePeriods, attendanceEvents, attendanceCorrectionRequests,
attendancePeriodSummaries, leaveRequests, leaveLedgerEntries, payrollRuns,
payrollEntries, payrollEntryLines, payrollDisbursements, invoices, invoiceLines,
invoiceReceipts, documents, documentRequests, timesheetPeriods, timesheetPolicies,
notifications, notificationDeliveries, performanceReviews, performanceReviewRatings,
udinRegistrations, dscCertificates, dscCustodyEvents, statutoryNotices,
servicePackages, servicePackageItems, clientPackageAssignments,
clientPackageAssignmentServices, engagementLetters, engagementLetterServices,
workItemSteps, workReviewRounds, workEscalations, filingAcknowledgements,
auditEvents, personalTodos, clientAcceptances, clientAcceptanceChecks,
clientComplianceSchedules, complianceExtensions, escalationRules,
employeeBankAccounts, clientPortalUsers, clientPortalCredentials,
holidayCalendar, userSessions, authRateLimits, clientPortalSessions
```

The consequence is that after `npm run db:seed:local` a signed-in user finds
Attendance, Salary, Billing, Documents, Timesheets, Registers, Performance and
Client Packages empty. The product cannot be demonstrated, and a developer
cannot see a workspace in its populated state without hand-entering data.

A related symptom: the current development database contains hand-seeded
register rows that `seed.ts` does not create, so a fresh clone does not match
the machine the feature was built on. This work removes that divergence.

## Decisions

Four decisions were settled before design.

**Scope.** Fill the empty workspaces for the existing seeded firm. Not a
separate demo tenant, and not merely documenting the existing command.

**Time anchoring: hybrid.** Statutory rate versions, joining dates and salary
structures remain fixed literals in `seed.ts` and are not touched. They are
effective-dated records modelling real law; generating them from the run date
would invent statutory dates. Transactional history is generated relative to the
month the seed runs in, so the demo does not visibly age.

**Invocation: a separate opt-in command.** A new `db:seed:demo` script, never
part of `db:setup:local`. Setting up a real firm yields masters only. This
matters because the code ships to a production host; a real firm must not
receive fabricated payroll runs and invoices as a side effect of setup.

**Depth: one closed month plus the current month in progress.** The smallest
dataset that still exercises every terminal state.

## Approach

The seed drives the product's own service layer rather than inserting rows
directly. It behaves as a scripted operator: to produce a locked attendance
month it calls `prepareAttendancePeriod`, `recordManualAttendance`,
`moveAttendancePeriodToReview` and `lockAttendancePeriod`, in that order, as the
functions the UI calls.

This was chosen over direct inserts for four reasons.

1. Every state it produces is one the product can produce. A direct insert can
   write a combination the application would refuse, and nothing would catch it.
2. Audit events, notifications and leave-ledger entries arise as side effects
   instead of being fabricated. Those workspaces populate for free, and populate
   correctly.
3. Separation of duties is exercised rather than bypassed. The partner approves
   the payroll run the administrator submitted, which is both more realistic and
   a live check that the rule works.
4. When a workflow changes, the seed fails loudly at the call site instead of
   silently continuing to write rows that are no longer valid. A seed that
   restates each state machine is a second copy that drifts.

The cost is accepted deliberately: it is slower than bulk insertion, ordering
between modules is strict, and each call needs a plausible actor and reason
string.

An earlier draft of this design reserved a second style — direct inserts for
"flat reference rows" such as the registers and personal todos. Checking the
modules showed that bucket is empty: `recordUdin`, `recordDscCertificate`,
`recordDscCustodyMovement`, `recordNotice`, `updateNoticeStatus`, `createTodo`
and `assignClientPackage` all exist, and `recordDscCustodyMovement` maintains
the custody trail, which is precisely a lifecycle. The design therefore uses one
style throughout. Direct insertion is reserved for a table that has no service
function and genuinely needs a row, and no such table has been identified.

Tables deliberately left empty are listed under Out of scope.

## Architecture

`scripts/db/seed-demo.ts` is the entry point. It mirrors the structure of
`seed.ts`: an exported `seedDemoHistory(database, options)` plus a `main()`
guarded by the `import.meta.url === pathToFileURL(process.argv[1]).href` check,
so the integration test can call the function directly the way
`tests/postgres-integration.test.ts` already calls `seedDevelopmentData`.

The work splits into `scripts/db/demo/`, one module per workspace, each
exporting a single async function taking `(database, context)`. `seed.ts` is
1115 lines; this must not become the second file of that size.

Module order is forced by the data, not by preference:

| Module | Creates | Depends on |
| --- | --- | --- |
| `calendar.ts` | holiday calendar rows via `saveHoliday` | masters |
| `attendance.ts` | periods, days, leave requests, corrections | holidays |
| `payroll.ts` | runs, entries, lines, disbursements | locked attendance |
| `packages.ts` | service packages, client assignments | service catalogue |
| `billing.ts` | invoices, lines, receipts | package assignments |
| `documents.ts` | requests, uploads with generated bytes | clients, work items |
| `timesheets.ts` | policy, periods, time entries | clients, work items |
| `work.ts` | steps, review rounds, escalations, filing acks | work items |
| `registers.ts` | UDIN, DSC certificates and custody, notices | clients, employees |
| `performance.ts` | reviews and ratings | employees, evidence |

Holidays must precede attendance because active public holidays are removed from
scheduled working days when a month is prepared and again when it is locked.
Seeding attendance first would mark employees absent on a firm closure.

The shared `context` carries the tenant id, the resolved calendar, and the
actor user ids resolved from the seeded fixture by role — the administrator, the
partner (Priya M.), the two managers and the associates. Modules do not look
users up themselves.

## Time model

A single helper, `resolveDemoCalendar(now = new Date())`, returns
`{ closedMonth, currentMonth }` as period keys, using the existing
`indiaPeriodKey` from `lib/attendance/calculations.ts` so the boundary is IST
rather than UTC. `closedMonth` is the previous IST month; `currentMonth` is the
current one.

Every generated date derives from those two keys. No module reads the clock
independently; `now` is passed in, which is what makes the pure parts testable.

Masters are not touched. `effectiveFrom: "2026-04-01"`, the joining dates, and
the salary structures stay as fixed literals in `seed.ts`.

## Dataset

Across the six seeded employees and five seeded clients.

**Closed month — every workflow reaches a terminal state.**

Attendance is prepared, filled, reviewed and locked, with a realistic mix across
the month: present, late, work-from-home, leave, half day, weekly offs, and one
public holiday seeded by `calendar.ts`. Payroll follows: created, submitted by
the administrator, approved by Priya M. the partner, payslips published, and
marked paid. Timesheets are submitted and approved. Invoices are issued, one of
them settled with a receipt.

**Current month — deliberately incomplete.**

Attendance is prepared and filled only to today. There is no payroll run,
because the month is not locked. That absence is load-bearing: it demonstrates
the dependency between attendance locking and payroll rather than presenting a
world where the constraint does not exist. Timesheets are open with entries
against them. One invoice sits in draft.

**Ages that make the registers and receivables readable.**

Invoices land at three ages so receivables ageing has something to show: one
paid, one issued and past its due date, one draft. Notices are seeded at
differing statuses across the `open`, `in_progress`, `responded` and `closed`
states. DSC certificates carry custody movements so the trail is non-trivial,
including one certificate approaching expiry so the alert surface is populated.

**Documents carry real bytes.**

Uploads go through `storeDocumentFile(tenantId, bytes)`, which handles hashing
and storage behind the same abstraction for both the local and S3 drivers.
Generated placeholder content means a download in the demo actually returns a
file rather than failing. Some requests are left outstanding.

**Notifications and audit events are not seeded.** They are produced by the
service calls above. If they do not appear, that is a finding about the product,
not something for the seed to paper over.

## Idempotency

`seed.ts` achieves idempotency through deterministic UUIDs and
`onConflictDoUpdate`. That technique does not transfer here, because service
functions mint their own identifiers.

Instead each module opens with an existence probe keyed on its period: if the
closed month's attendance period already exists, the module returns without
doing work. Re-running `db:seed:demo` is a no-op.

One consequence must be documented rather than discovered. Because the dates
roll, running the seed in a later month creates that later month's data rather
than replacing what exists. The dataset extends; it does not duplicate. This
differs from `seed.ts`, where a re-run always converges on the same rows.

## Failure behaviour

The script cannot wrap its work in a single transaction, because each service
function opens its own. Work is therefore committed per module, and a failure
midway leaves earlier modules applied.

The existence probes are what make that recoverable: the cause is fixed and the
script re-run, and completed modules skip. The failure message names the module
that failed so the point of failure is not inferred from a stack trace.

Before doing anything, the script verifies that the base seed has run — the
tenant and its members exist — and exits with a direct instruction to run
`db:seed:local` first if not. Failing obscurely on a missing tenant partway
through is not acceptable.

On success it prints a summary of what it created, as `seed.ts` does.

## Testing

**Unit** — `tests/demo-seed-unit.test.ts`, no database. Covers the pure parts:
`resolveDemoCalendar` at month and year boundaries and across the IST offset,
the attendance pattern generator (that it produces valid `AttendanceStatus`
values, respects weekly offs, and does not schedule work on a holiday), and the
money helpers.

**Integration** — extends `tests/postgres-integration.test.ts` beside the
existing seed test at line 75. Runs `seedDemoHistory` twice against the isolated
`_test` database and asserts the row counts match, mirroring how
`seedDevelopmentData` is already covered. A second test asserts the closed
month's payroll run reaches `paid` and its attendance period reaches `locked`,
so a regression in the ordering is caught rather than producing a quietly
half-finished dataset.

## Manual

`AGENTS.md` requires the manual to ship with the change, and adding an npm
script is explicitly on its list. `app/manual/chapters-setup.tsx` gains the new
command and a description of what it creates and when not to run it.
`tests/manual-coverage-unit.test.ts` fails until that is done.

## Out of scope

Not seeded, deliberately:

- `userSessions`, `authRateLimits`, `clientPortalSessions` — runtime session
  state. Fabricating sessions would be meaningless at best.
- `notificationDeliveries` beyond what the notification engine produces from the
  seeded activity.
- `attendancePeriodSummaries` where they are derived rather than authored.
- A second tenant. Isolation was considered and rejected in favour of filling
  the existing firm.
- Any change to `seed.ts`'s existing masters, dates or fixture content.

## What this does not change

`npm run db:setup:local` behaves exactly as it does today. The new command is
additive and opt-in, and no existing script invokes it.
