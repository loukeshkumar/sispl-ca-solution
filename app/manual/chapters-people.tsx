import { Chapter, Fields, Note, Path, Pipeline, Steps } from "./manual-ui";

/** Chapters 19-24: attendance, pay, fees, signals, development, and the portal. */
export default function PeopleChapters() {
  return (
    <>
      <Chapter id="attendance">
        <p>
          What you see depends on your permissions. Everyone gets their own register; reviewers get an approval queue;
          administrators get the tenant register and month control.
        </p>

        <h3>As an employee</h3>
        <Steps>
          <li><strong>Check in</strong> when you start and <strong>check out</strong> when you finish. Events are immutable once recorded.</li>
          <li>Your monthly register shows present days, late marks, missing punches, on-leave days and exceptions, plus your leave balance and entitlement.</li>
          <li>
            <strong>Request leave</strong> &mdash; leave type from the masters, from and to dates, duration (full day, half
            day, first half or second half), pay classification of paid or unpaid, and a reason for the reviewer.
          </li>
          <li>
            <strong>Request a correction</strong> for a specific date &mdash; proposed status (present, absent, leave, work
            from home, client duty or tour, late), proposed check-in and check-out times, and a reason.
          </li>
          <li><strong>Request history</strong> shows every request you have made and its outcome.</li>
        </Steps>

        <h3>As a reviewer</h3>
        <p>
          The approval queue lists requests from your reportees only, never the whole firm. Open a request and approve or
          reject it. Decisions are recorded against the request.
        </p>

        <h3>As an administrator</h3>
        <p>With <code>attendance:manage</code> you also get the tenant-wide register and the month controls.</p>

        <h4>Employee work profiles</h4>
        <p>
          Per person: employment type including articled assistant, state or UT, work location, reporting manager, standard
          start and standard end. A person with no shift falls back to the tenant attendance policy.
        </p>

        <h4>Attendance policy</h4>
        <p>Effective-dated. Create a new version with an effective-from date rather than editing history.</p>

        <h4>The monthly cycle</h4>
        <Pipeline
          states={[
            { step: "open", label: "Prepare month" },
            { step: "review", label: "Start review" },
            { step: "locked", label: "Lock attendance", mark: "locked" },
            { step: "back to open", label: "Reopen month" },
          ]}
        />

        <Steps>
          <li><strong>Prepare month</strong> builds the month&rsquo;s scheduled working days. Active public holidays are removed at this point, so nobody is marked absent on a firm closure.</li>
          <li>Resolve exceptions. Use the attendance matrix to mark individual cells, or record manual attendance where a punch is genuinely missing. Clear the pending request queue.</li>
          <li><strong>Start review</strong> moves the period from open to review.</li>
          <li><strong>Lock attendance</strong> moves review to locked, applying the holiday calendar once more. The locked summary is immutable and is what payroll consumes.</li>
          <li>If something was wrong, <strong>reopen the month</strong> with a recorded reason. Everything downstream must then be redone.</li>
        </Steps>

        <Note tag="Order matters" tone="care">
          <p>
            You cannot create the matching payroll run until the attendance month is <strong>locked</strong>. And a locked
            month is never recalculated by later master-data edits.
          </p>
        </Note>
      </Chapter>

      <Chapter id="salary">
        <Note tag="Who sees what">
          <p>
            Employees see <strong>only their own published payslips</strong>. Administrators and partners manage structures
            and runs. <strong>Managers receive no salary amounts at all.</strong>
          </p>
        </Note>

        <h3>Step one &mdash; salary structures</h3>
        <Steps>
          <li>Open <strong>Salary</strong> and select the employee under employee salary setup.</li>
          <li>Set <strong>effective from</strong>. Structures are effective-dated: you supersede, you do not overwrite.</li>
          <li>
            Add <strong>components</strong>, each with a code, label, monthly amount and type &mdash; an earning such as
            <code> BASIC</code> or <code>HRA</code>, a recurring deduction, or an employer contribution such as
            <code> EMPLOYER_PF</code>.
          </li>
          <li>Save. Component codes must be unique within a structure.</li>
        </Steps>
        <p>All INR values are stored as integer paise.</p>

        <h3>Step two &mdash; the payroll run</h3>

        <Pipeline
          states={[
            { step: "1", label: "draft" },
            { step: "2", label: "submitted" },
            { step: "3", label: "approved_locked", mark: "locked" },
            { step: "4", label: "payslips_published" },
            { step: "5", label: "paid", mark: "done" },
          ]}
        />

        <Steps>
          <li>
            <strong>Create payroll.</strong> Choose the payroll month and pay date. A run can only be created for a month
            whose attendance is <strong>locked</strong>, and it consumes that immutable summary.
          </li>
          <li>
            <strong>Review the draft.</strong> Each entry shows calendar working days, scheduled days, excluded days, payable
            days, LOP days, full gross, proration deduction, attendance deduction, earned gross, total deductions and net pay.
          </li>
          <li>
            <strong>Enter the statutory amounts.</strong> PF, ESI and PT are <em>suggested</em> from effective-dated rate
            versions; TDS is entirely manual. Review every figure and enter what the firm stands behind. Entries can only be
            changed while the run is <code>draft</code>.
            <Note tag="How rates behave" tone="care">
              <p>
                Every rate, ceiling, threshold and rounding rule is a stored parameter, so a historic run recomputes with the
                rules in force at the time. A rule with no configured version is <strong>reported as missing</strong> rather
                than treated as nil. Seeded rates are firm-reviewable defaults carrying a source reference you replace after
                verifying the governing notification.
              </p>
            </Note>
          </li>
          <li><strong>Submit payroll.</strong> The run moves to <code>submitted</code> and entries freeze.</li>
          <li>
            <strong>Approve.</strong> A partner approves and locks the run with an authorization reason.
            <Note tag="Separation of duties" tone="limit">
              <p>
                The person who prepared or submitted the run cannot approve it &mdash; <em>unless</em> they are a firm
                administrator, in which case the same-person override is permitted but audited and requires a reason. To send
                it back instead, reject the run with a reason; it returns to <code>draft</code>.
              </p>
            </Note>
          </li>
          <li>
            <strong>Publish payslips</strong> &mdash; a separate, deliberate action with a publication reason. Only now can
            each employee see their own payslip at <Path>/salary/payslips/&lt;id&gt;</Path>.
          </li>
          <li><strong>Mark paid</strong> &mdash; requires a payment reference and a payment reason. This records that money moved; it does not move it.</li>
        </Steps>

        <p>
          Reopening takes an <code>approved_locked</code> or <code>payslips_published</code> run back to <code>draft</code>,
          clearing the submission and approval marks. Use it only when something is genuinely wrong.
        </p>

        <h3>Step three &mdash; the bank file</h3>
        <p>
          Once a run is approved and locked, generate a generic NEFT/RTGS instruction CSV from the run page. It requires the
          same authority as approving payroll, and every generated batch is recorded for audit.
        </p>

        <Note tag="Stated exclusions, not silent skips" tone="limit">
          <p>
            Held employees, nil net pay, and employees without payment instructions are <strong>reported as exclusions</strong>
            in the output rather than quietly dropped. SISPL never connects to a bank and never initiates a payment: money
            moves only when someone uploads and authorises the file at the bank.
          </p>
        </Note>

        <p>
          A separate CSV export of the run itself, with per-employee days and amounts in paise, is available to holders of
          <code> salary:manage</code>. Every export view is recorded as a payroll access event.
        </p>

        <h3>What an employee sees</h3>
        <p>Only their own published payslips, each opening to a full payslip. Nothing else in the module.</p>
      </Chapter>

      <Chapter id="billing">
        <h3>Raising an invoice</h3>
        <Steps>
          <li>Open <strong>Billing</strong> with <kbd>g</kbd> <kbd>b</kbd> and choose <strong>New invoice</strong>.</li>
          <li>
            Fill the header.
            <Fields
              rows={[
                { term: "Client", note: "The legal entity. Required" },
                { term: "Package agreement", note: "Optional — links the invoice to the agreement it arises from" },
                { term: "Billing period", note: "For example, August 2026" },
                { term: "Notes", note: "Optional" },
              ]}
            />
          </li>
          <li>Add <strong>invoice lines</strong> &mdash; description and amount in INR.</li>
          <li>
            Enter the <strong>tax amount</strong>. It is entered as reviewed, by you &mdash; SISPL does not work out
            what the tax should be, and applies no rate. What it does do is decide how the amount you entered is
            <em> split</em>: it compares the firm&rsquo;s state against the place of supply, and records CGST and SGST
            in equal halves for a supply inside the state, or the whole amount as IGST for one that crosses a state
            line. Set the firm&rsquo;s state and each client&rsquo;s state, or an invoice cannot be issued: an issued
            invoice is a document somebody files from, so it must say where the supply landed. An odd number of paise
            on an intra-state supply is rounded down by one, because the two halves have to be equal.
          </li>
          <li>Save as a draft.</li>
        </Steps>

        <h3>The invoice lifecycle</h3>
        <Pipeline
          states={[
            { step: "1", label: "draft" },
            { step: "2", label: "issued" },
            { step: "3", label: "paid", mark: "done" },
            { step: "any time", label: "cancelled" },
          ]}
        />
        <p>
          Open an invoice at <Path>/billing/&lt;id&gt;</Path> to issue it, record a payment against it, or cancel it. The
          register filters by status and searches by number, client or period; the header reports drafts, outstanding, overdue
          and collected this month.
        </p>

        <h3>Billing from recorded time</h3>
        <p>
          <Path>/billing/from-time</Path> lists unbilled time by client and period, valued at rate-card rates, and turns a
          selection into a draft invoice. This is the bridge from Timesheets to Billing, and it is not automatic.
        </p>

        <h3>Tally export</h3>
        <p>Exporting to Tally produces import-ready XML in two datasets:</p>
        <ul>
          <li><strong>ledgers</strong> &mdash; master records</li>
          <li><strong>invoices</strong> &mdash; sales vouchers for a date range you specify</li>
        </ul>
        <p>It requires <code>billing:read</code>. One-way only: there is no live Tally connection and no import back into SISPL.</p>
      </Chapter>

      <Chapter id="insights">
        <p>
          Insights recomputes a set of rules over delivery, receivables, client health, team effort and the registers every
          time you load it. Signals are graded critical, warning or informational, filterable by severity, and each one opens
          to the records behind it.
        </p>

        <Note tag="What this is not" tone="limit">
          <p>
            These are rules, not predictions and not model output. There is no LLM anywhere in the product. Every signal is
            reproducible from the data and states its own evidence, which is why you can act on one without checking it twice.
          </p>
        </Note>

        <p>Insights requires <code>billing:read</code>, so it is an Admin-class view.</p>
      </Chapter>

      <Chapter id="development">
        <h3>Articleship register</h3>
        <p><Path>/team/articleship</Path>. The live register of articled assistants.</p>
        <ul>
          <li><strong>Register an article</strong> to start a registration</li>
          <li><strong>End a registration</strong></li>
          <li><strong>Record industrial training</strong></li>
          <li><strong>Articleship policy</strong> &mdash; the firm&rsquo;s leave and term rules</li>
        </ul>
        <p>
          Header counts cover in training, completing soon (within 60 days, or overrun), leave exceeded, and needing attention
          for paperwork, leave or term. Where leave has been exceeded, the register shows the term extended to make it up.
        </p>

        <h3>Training &amp; CPE</h3>
        <p>
          <Path>/team/training</Path>. Record a training or CPE activity against a person, remove one entered in error, and
          set the CPE policy for the firm. The header reports what was logged this year, members met, records held, and who is
          short over the block.
        </p>
        <Note tag="Blocks close" tone="care">
          <p>Earlier years cannot be redone. Record CPE in the year it happened.</p>
        </Note>

        <h3>Performance reviews</h3>
        <p>
          <Path>/team/performance</Path>, gated by <code>performance:review</code> for writing. Everyone can read the reviews
          written about themselves.
        </p>
        <Pipeline
          states={[
            { step: "1", label: "Create review" },
            { step: "2", label: "Save draft" },
            { step: "3", label: "Share" },
            { step: "4", label: "Acknowledge", mark: "done" },
          ]}
        />
        <p>
          A draft is not yet shown to anyone. Sharing makes it visible to the subject, who acknowledges it. The header tracks
          reviews in draft and reviews shared but not yet confirmed as read.
        </p>
      </Chapter>

      <Chapter id="portal">
        <h3>Giving a client access</h3>
        <Steps>
          <li>Open <strong>Client 360</strong> for the entity and find the client portal panel.</li>
          <li>Enter the contact name and contact email, then provision.</li>
          <li>SISPL creates a <strong>one-time password</strong>, revokes any prior portal sessions for that contact, and forces a password change at first sign-in.</li>
          <li>Send the contact to <Path>/portal/login</Path> with the firm ID, their email, and the one-time password.</li>
          <li>To end access, revoke it. Live sessions end immediately.</li>
        </Steps>

        <h3>What the contact sees</h3>
        <p>Three things, and nothing else:</p>
        <ul>
          <li><strong>Your compliance status</strong> &mdash; active obligations with service, period and statutory due date, as tracked by your firm</li>
          <li><strong>Documents your firm needs</strong> &mdash; the open requests, with an upload form for each</li>
          <li><strong>Outstanding invoices</strong> &mdash; issued and unpaid, with amount, period and status</li>
        </ul>
        <p>They can change their own password and sign out.</p>

        <Note tag="Isolation">
          <p>
            Portal accounts are a separate identity store with their own credentials, sessions and cookie. Every portal query
            is scoped to <strong>both</strong> the tenant and the single legal entity the contact belongs to. A portal token
            can never open a staff session, and a staff token can never open a portal session.
          </p>
        </Note>
      </Chapter>
    </>
  );
}
