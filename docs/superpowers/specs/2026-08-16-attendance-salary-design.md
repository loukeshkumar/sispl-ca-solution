# Employee Attendance and Salary Management Design

## Goal

Add two production-oriented modules for a Bihar-based CA office: an auditable employee Attendance system and a confidential monthly Salary/Payroll system. Attendance produces a locked monthly employee summary; payroll consumes an immutable snapshot of that summary.

## Research basis

Three independent online research tracks covered current Indian payroll law, attendance/leave obligations, and current HR-product workflows. The design follows these conclusions:

- Attendance corrections preserve original values, proposed values, reason, reviewer, decision, and timestamps.
- Attendance months are reviewed and locked before payroll; later corrections require controlled reopening.
- Salary structures are effective-dated and historical payroll stores snapshots rather than rereading mutable master data.
- Payroll preparation, approval/locking, payslip publication, and payment are separate audited states.
- State-specific leave, holiday, minimum-wage, professional-tax, and establishment rules are configuration, not universal constants.
- The first release records administrator-entered statutory deductions instead of claiming to be a PF, ESI, PT, TDS, or filing engine.

Primary references include the Code on Wages, 2019; Code on Wages (Central) Rules, 2026; Ministry of Labour guidance; ICAI articleship guidance; and current Zoho Payroll, Keka, greytHR, and RazorpayX Payroll documentation.

## Jurisdiction and defaults

- Jurisdiction: Bihar, India.
- Time zone: `Asia/Kolkata`.
- Currency: INR, stored as integer paise.
- Pay frequency: monthly.
- Default work week: Monday through Saturday, configurable at tenant level.
- Default schedule: 09:30 to 18:00 with a 15-minute late grace, configurable.
- Policies are effective-dated so a future change does not rewrite historical attendance or payroll.
- ICAI articled assistants have a distinct employment classification and policy label; the application does not merge their leave/working-hour rules with ordinary employees.

## Authorization model

Add explicit permissions rather than reusing general team access:

- `attendance:use`: every active employee can see own attendance, check in/out, and submit own leave/correction requests.
- `attendance:review`: managers can review reportee attendance and requests; administrators and partners can review the full tenant.
- `attendance:manage`: administrators and partners can configure policy, record authorized manual attendance, reopen periods, and lock periods.
- `salary:read:own`: every active employee can see only published own payslips.
- `salary:manage`: administrators and partners manage salary structures, draft payroll, adjustments, and submission.
- `salary:approve`: partners approve/lock, reject/reopen, publish, and mark payroll paid. Firm administrators can use an audited same-person override with a mandatory reason.

The browser never submits tenant scope, authorization scope, or an alternate current-user identity. Every repository query includes tenant identity and the correct employee/reportee scope.

## Employee reporting and work settings

Create a tenant-scoped employee work profile keyed by employee user ID:

- reporting manager user ID;
- employment classification (`employee` or `articled_assistant`);
- work location/state;
- active attendance policy version.

Managers can access only users who explicitly report to them. Partners and firm administrators retain tenant-wide attendance visibility. Managers never receive salary amounts.

## Attendance domain

### Attendance policy

An effective-dated tenant policy stores time zone, jurisdiction, working weekdays, standard start/end, late grace, full-day minutes, and half-day minutes. Validation prevents invalid or overlapping active policy versions.

### Daily ledger

Each employee/date has one derived attendance day with status:

`present`, `absent`, `leave`, `half_day`, `late`, `missing_punch`, `weekly_off`, `holiday`, `wfh`, `tour`.

The row stores first check-in, last check-out, worked minutes, late minutes, note, source, and a version. Raw check-in/check-out/manual-adjustment events are append-only and retain actor, source, time, and reason.

Check-out requires an open check-in. A second check-in cannot overwrite an open session. All timestamps are stored with a time zone and displayed in `Asia/Kolkata`.

### Requests and approvals

Leave requests store from/to dates, leave type, day portion, paid/unpaid classification, reason, status, reviewer, and decision metadata. Correction requests store the attendance date, original snapshot, proposed status/times, reason, record version, reviewer, and decision metadata.

An employee cannot approve their own request. Approval uses a conditional version check and writes the resulting attendance event/day in one transaction. Rejection and cancellation preserve history.

### Monthly period and summary

Each `YYYY-MM` attendance period moves from `open` to `review` to `locked`. Locking is transactional and fails while pending requests or missing-punch exceptions remain. It creates one immutable employee summary containing scheduled days, present days, paid/unpaid leave units, absence/LOP units, overtime minutes, late count, and a source hash.

Reopening requires `attendance:manage`, a reason, an audit event, and no approved or later payroll run consuming the period.

### Attendance UI

- Sidebar destination: **Attendance**.
- Employee view: today's status, check-in/out, current-month calendar, totals, leave request, correction request, and request history.
- Manager/admin view: exception KPIs, reportee/team register, pending approval queue, status filters, daily manual marking, monthly review, and lock control.
- Responsive card layout below tablet width; statuses always use text plus color/icon.

## Salary and payroll domain

### Salary structures

Each employee can have multiple non-overlapping effective-dated salary structure versions. Lines have a stable code, label, kind (`earning`, `deduction`, `employer_contribution`), and monthly amount in paise. Activating a new version supersedes the previous version from its effective date without mutating history.

The interface starts with Basic, HRA, Other allowance, and Recurring deduction conveniences while the data model remains component-based.

### Payroll runs

One regular payroll run exists per tenant and month. Creation requires the matching attendance period to be locked. The run snapshots:

- employee identity and designation;
- applicable salary structure and component values;
- locked attendance summary;
- scheduled/payable/LOP half-day units;
- gross, attendance deduction, recurring deductions, one-time additions/deductions, manually entered PF/ESI/PT/TDS, net pay, and employer cost.

Proration uses integer half-day units and deterministic integer rounding. Negative net pay, missing salary structures, unresolved holds, stale attendance, and invalid payment dates block submission.

### Workflow

`draft -> submitted -> approved_locked -> payslips_published -> paid`

- Draft: salary operators can recalculate, add adjustments, enter statutory amounts, or hold an employee.
- Submitted: immutable pending approval; approver can reject to draft with a reason.
- Approved and locked: calculations are immutable.
- Payslips published: employees can access only their own payslip.
- Paid: records payment date/reference and closes the run.
- Reopening after approval is allowed only before payment, requires an authorized reason, retracts published access, increments the run version, and is audited.

### Payroll UI

- Sidebar destination: **Salary**.
- Employee view: current salary summary and published payslip history only.
- Administrator/partner view: month selector, workflow stepper, headcount/gross/deductions/net/LOP KPIs, employee payroll register, exception/hold indicators, salary-structure editor, run preparation, and controlled transition actions.
- Print-optimized secure payslip page and CSV payroll-register export.

## Privacy, audit, and retention

- Salary, bank, tax, and payslip data is denied to managers and unrelated employees.
- Routine screens contain no PAN, Aadhaar, UAN, bank-account, ESIC, or tax identifiers in this release.
- All view/export/mutation transitions that expose or change payroll are audited.
- Attendance day, request, summary, salary version, payroll snapshot, and transition history remain tenant scoped.
- Register data can be retained for five years through policy; raw sensitive evidence is not retained longer merely because the derived register is retained.
- CSV and payslip filenames contain opaque payroll IDs or safe employee codes, never sensitive identifiers.

## Error and concurrency behavior

- Invalid fields return accessible field-level errors.
- Cross-tenant and unauthorized employee IDs behave as not found.
- Conditional updates prevent duplicate check-out, duplicate approval, double payroll approval, double publication, and double payment.
- Stale correction versions fail safely and require refresh.
- Transactional period locking and payroll state changes either complete fully or leave no partial state.
- Database constraints enforce allowed statuses, non-negative amounts/minutes, date ranges, unique periods, state timestamps, tenant relationships, and non-overlapping active structures where practical.

## Deferred scope

Biometric/GPS collection, external time-clock integrations, automatic leave accrual packs, automatic PF/ESI/PT/TDS computation, statutory filing, bank disbursement, tax declarations, reimbursements, loans, arrears/off-cycle payroll, full-and-final settlement, and native mobile apps are excluded.

## Verification

- Test-first validation and calculation tests.
- Permission matrix tests.
- Repository source boundary tests.
- PostgreSQL integration tests for tenant/reportee/own-data isolation, request concurrency, attendance locking, salary version history, payroll snapshots, workflow transitions, and payslip privacy.
- UI contract and accessibility tests.
- Local migration and table check.
- TypeScript, ESLint, all unit tests, PostgreSQL integration tests, production build, and local development smoke check.
