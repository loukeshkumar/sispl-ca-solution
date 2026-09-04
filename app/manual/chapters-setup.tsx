import { Chapter, Fields, Note, Path, Pipeline, Steps, TableFrame } from "./manual-ui";

/** Chapters 5-10: everything a firm configures before it can deliver anything. */
export default function SetupChapters() {
  return (
    <>
      <Chapter id="day-one">
        <p>
          Sign in as the Super Admin and work down this list. The order matters: work items can only be raised for services
          the client&rsquo;s package entitles, packages are built from the service master, and the service master is where
          work budgets come from.
        </p>

        <Steps>
          <li><strong>Service Management</strong> &mdash; define every service the firm sells, with a code, category and standard effort. <em>Everything downstream selects from here.</em></li>
          <li><strong>Work Procedures</strong> &mdash; write the standard steps for each service and publish them.</li>
          <li><strong>Master Data</strong> &mdash; the documents-needed checklist, so document requests stay consistent.</li>
          <li><strong>Attendance Masters</strong> &mdash; leave types, holidays and shift types.</li>
          <li><strong>Rate Card</strong> &mdash; charge-out and cost rates per person.</li>
          <li><strong>Utilisation Targets</strong> &mdash; role targets and per-person overrides.</li>
          <li><strong>User Roles Management</strong> &mdash; the reusable access roles you will assign to people.</li>
          <li><strong>Employees</strong> &mdash; add people, then provision their access.</li>
          <li><strong>Compliance schedules</strong> &mdash; the recurring obligation calendar per service.</li>
          <li><strong>Package Setup, then Client Packages</strong> &mdash; compose packages, then assign one to each client.</li>
        </Steps>

        <p>
          Clients can be added at any point, but until a client has an effective package you cannot raise work for a service
          the package does not include.
        </p>
      </Chapter>

      <Chapter id="services">
        <h3>Service Management</h3>
        <p>
          <strong>Settings &rarr; Service Management.</strong> The tenant-wide service master. Administrators and partners
          create, edit and archive; managers get read-only access. Active services flow into package, client and
          compliance-work selectors.
        </p>

        <Steps>
          <li>Open <strong>Settings &rarr; Service Management</strong>.</li>
          <li>Choose <strong>Create service</strong>.</li>
          <li>
            Fill the form.
            <Fields
              rows={[
                { term: "Code", note: <>Short key, for example <code>GST</code></> },
                { term: "Name", note: "For example, GST compliance" },
                { term: "Category", note: "For example, Indirect tax" },
                { term: "Description", note: "What the service covers" },
                { term: "Standard effort", note: "Minutes. Optional, but see the note below" },
              ]}
            />
          </li>
          <li>Save. The header counters for active services, archived, categories and package links update.</li>
        </Steps>

        <Note tag="Why standard effort matters" tone="care">
          <p>
            A new work item <strong>copies the standard effort once, at creation</strong>, as its budget. Editing the standard
            afterwards never rewrites budgets on work already raised, so historic budget-versus-actual stays comparable. A
            service with no standard produces work showing <em>No budget</em>, and the capacity view reports those separately
            so an empty lane reads as unknown rather than free.
          </p>
        </Note>

        <p>Archiving keeps a service in history and only removes it from future selectors. The workspace also links across to compliance schedules.</p>

        <h3>Work Procedures</h3>
        <p>
          <strong>Settings &rarr; Work Procedures</strong> at <Path>/settings/procedures</Path>. Standard steps per service,
          versioned through a small lifecycle.
        </p>

        <Pipeline
          states={[
            { step: "1", label: "draft" },
            { step: "2", label: "published", mark: "done" },
            { step: "3", label: "archived" },
          ]}
        />

        <Steps>
          <li>Open the page and pick a service. The header shows services covered, steps published, drafts, and how many services are still uncovered.</li>
          <li><strong>Draft</strong> a procedure and add its steps in order.</li>
          <li><strong>Revise</strong> the draft as many times as needed. A draft affects nothing live.</li>
          <li><strong>Publish</strong> it. From then on, every work item for that service shows the steps in its procedure panel.</li>
          <li><strong>Archive</strong> when a procedure is superseded.</li>
        </Steps>

        <p>
          On a work item, each step can be marked done, undone, or recorded as not applicable with a reason. The reason
          matters: <em>a step skipped without a reason cannot be told from one forgotten.</em>
        </p>

        <h3>Compliance schedules</h3>
        <p>
          <Path>/settings/compliance</Path>, reached from the compliance schedules link in Service Management. Three things
          live here.
        </p>
        <ul>
          <li><strong>Schedule register</strong> &mdash; versioned, effective-dated recurring obligations per service. The recurrence job reads these to generate upcoming work.</li>
          <li><strong>Client schedule register</strong> &mdash; per-client overrides. You can also record an extension when a due date is formally extended.</li>
          <li>
            <strong>Escalation ladder</strong> &mdash; rungs that fire as a deadline approaches and is not met. Add a rung, or
            archive one you no longer want. The notifications job climbs the ladder after sending the day&rsquo;s reminders,
            so a rung reads as the escalation of something the assignee has already been told about.
          </li>
        </ul>
      </Chapter>

      <Chapter id="masters">
        <h3>Master Data &mdash; documents needed</h3>
        <p>
          <strong>Settings &rarr; Master Data</strong> at <Path>/settings/master-data</Path>. Standard client documents
          defined once, so titles, instructions and lead times stay consistent across requests.
        </p>
        <p>
          Each checklist entry carries a code, name, category, standard instructions, an optional service link, a lead time in
          days, and whether it is usually mandatory. When you raise a document request, picking one of these fills the title,
          instructions and due date for you. Free text is still available.
        </p>

        <Note tag="History is safe">
          <p>Archiving an entry keeps it in history and only removes it from future requests. Requests already raised keep their original wording.</p>
        </Note>

        <h3>Attendance Masters</h3>
        <p><strong>Settings &rarr; Attendance Masters</strong> at <Path>/settings/attendance</Path>. Three masters the attendance workspace runs on.</p>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Master</th><th>Fields</th><th>Effect</th></tr></thead>
            <tbody>
              <tr>
                <td><strong>Leave types</strong></td>
                <td>Code, paid by default, half-day allowance, annual quota</td>
                <td>Drives the leave request form. Six codes are seeded — casual, sick, earned, compensatory, maternity, other — so historic requests stay valid</td>
              </tr>
              <tr>
                <td><strong>Holidays</strong></td>
                <td>Date, state or UT, public or not</td>
                <td>Active public holidays are removed from scheduled working days when a month is prepared and when it is locked, so nobody is marked absent on a firm closure</td>
              </tr>
              <tr>
                <td><strong>Shift types</strong></td>
                <td>Timings, working week, full and half-day minutes, late grace</td>
                <td>Exactly one may be the firm default. An employee with no shift falls back to the tenant attendance policy</td>
              </tr>
            </tbody>
          </table>
        </TableFrame>

        <p>Records can be edited in place to correct a name, date or timing. Archiving is reserved for retiring a record and keeps it in history.</p>

        <Note tag="Locked months never recalculate" tone="care">
          <p>An edit here only affects periods prepared afterwards. A month already locked keeps the numbers it was locked with.</p>
        </Note>

        <h3>Rate Card</h3>
        <p>
          <strong>Settings &rarr; Rate Card</strong> at <Path>/settings/rates</Path>. Charge-out and cost rates per person,
          plus negotiated per-client overrides. Save a rate, save an override, remove an override. The header reports rated
          people, negotiated rates, average charge and average margin. These rates are what turn recorded time into unbilled
          value and margin in Timesheets and Billing.
        </p>

        <h3>Utilisation Targets</h3>
        <p>
          <strong>Settings &rarr; Utilisation Targets</strong> at <Path>/settings/utilisation</Path>. Set a target per role,
          override it for individuals, or remove an override. The attainment panel shows firm utilisation and how many people
          are meeting target.
        </p>
      </Chapter>

      <Chapter id="roles">
        <h3>The three access classes</h3>
        <Fields
          rows={[
            { term: "Super Admin", note: "A sealed full-access class. Only a Super Admin can create delegated Admin roles or assign Admin accounts. The last Super Admin cannot be removed." },
            { term: "Admin", note: "Delegated administration. Created and assigned only by a Super Admin." },
            { term: "Employee", note: "Every employee gets exactly one reusable Employee category role. There are no one-off per-person permission overrides, by design." },
          ]}
        />

        <h3>Creating a role</h3>
        <Steps>
          <li>Open <strong>Settings &rarr; User Roles Management</strong>.</li>
          <li>Choose <strong>Create role</strong>. Pick whether it is an Admin role or an Employee category.</li>
          <li>
            Tick the permissions. High-risk and critical permissions are marked; some are restricted to the Admin class, and
            <code> roles:manage</code> is Super Admin only.
          </li>
          <li>Save. The register shows each role&rsquo;s permission count and assigned users.</li>
        </Steps>

        <Note tag="Reductions apply immediately" tone="care">
          <p>
            Updating a role increments its authorization version, writes an audit event, and
            <strong> revokes every affected active session</strong>, so a reduced permission applies on the person&rsquo;s
            very next request rather than at their next sign-in.
          </p>
        </Note>

        <p>
          From the members view of a role you can also reset a member&rsquo;s password, which issues a new one-time password,
          or expire it, which forces a change at next sign-in. Archive a role definition you no longer use.
        </p>
        <p>
          Permissions are evaluated on the server for every protected request. Accounts that predate role definitions resolve
          through one shared legacy map, so session resolution and permission checks cannot diverge.
        </p>
      </Chapter>

      <Chapter id="employees">
        <h3>Adding an employee</h3>
        <Steps>
          <li>Open <strong>Employees</strong> with <kbd>g</kbd> <kbd>e</kbd> and choose <strong>Add employee</strong>.</li>
          <li>
            Fill the profile.
            <Fields
              rows={[
                { term: "Full name", note: "Required" },
                { term: "Email address", note: "Becomes their sign-in identity" },
                { term: "Mobile number", note: "For example, +91 98765 43210" },
                { term: "Designation", note: "For example, Audit Associate" },
                { term: "Joining date", note: "Drives tenure and payroll proration" },
                { term: "Qualification", note: "And the date qualified on" },
                { term: "ICAI membership no.", note: "Needed before they can sign a UDIN" },
                { term: "User role", note: "One access role. Admin roles are assignable only by a Super Admin" },
                { term: "Employment notes", note: "Responsibilities, expertise, internal context" },
              ]}
            />
          </li>
          <li>Save. The directory shows role, workload, active tasks and overdue assignments, with filters by role and status.</li>
        </Steps>

        <h3>Provisioning access</h3>
        <Steps>
          <li>Open the person&rsquo;s <strong>Employee 360</strong> record from the directory.</li>
          <li>In <strong>Account access</strong>, choose to provision access.</li>
          <li>SISPL generates a <strong>one-time random password</strong>, revokes any previous sessions for that person, and marks the password as requiring a permanent change.</li>
          <li>
            Hand the one-time password over out of band. At first sign-in they are forced to
            <Path>/account/change-password</Path> before reaching any workspace.
          </li>
        </Steps>
        <p>
          A newly provisioned employee automatically receives a Bihar attendance work profile, which you can change in the
          Attendance workspace. Disabling an employee revokes access; the record stays.
        </p>

        <h3>Employee 360</h3>
        <p>
          One record for everything about a person: tenure, reporting line, open work, assigned work, leave left, timesheet
          position, chargeable share, monthly gross, salary structure, statutory record, devices held, UDINs signed, CPE
          block, capability and recent history. Panels that decorate the record load independently and degrade to an empty
          state if they fail, so an enhancement can never block the record itself.
        </p>

        <h4>Capability</h4>
        <p>
          Records what a person is <em>trusted to do</em>, per service, at a level, with a note explaining the basis for the
          judgement. Add a capability, or withdraw one. The Employees workspace shows the resulting matrix of who can prepare,
          who can review, and who is still learning.
        </p>

        <h4>Bank account</h4>
        <p>Payment instructions for the payroll bank file: account holder name, account number, IFSC, bank name, and savings or current.</p>
        <Note tag="Handling" tone="limit">
          <p>
            Account numbers are stored because a bank file needs them, are
            <strong> masked to the last four digits everywhere they are displayed</strong>, and are never written to a log or
            an audit reason. Replacing instructions <em>retires</em> the previous account rather than editing it, so the trail
            stays intact.
          </p>
        </Note>

        <h4>Employment stage</h4>
        <p>Set the stage of a person&rsquo;s employment from the record. It feeds payroll proration and the articleship register.</p>

        <Note tag="Who can do what">
          <p>
            Team administration is limited to firm administrators and partners. Managers can read the directory and assign
            tasks. Associates can access and update only their own tasks. Admin accounts can only ever be created or assigned
            by a Super Admin.
          </p>
        </Note>
      </Chapter>

      <Chapter id="packages">
        <h3>Package Setup</h3>
        <p>Compose monthly, quarterly, annual or one-time packages from the active service master. Services are referenced, never duplicated.</p>
        <Steps>
          <li>Open <strong>Package Setup</strong> and choose <strong>Create package</strong>.</li>
          <li>Name it, then set the <strong>billing cycle</strong> and the <strong>fee</strong>.</li>
          <li>Tick the <strong>included services</strong> from the master.</li>
          <li>Save. The register shows active packages, archived packages, average package fee, and the services each includes.</li>
        </Steps>

        <h3>Client Packages</h3>
        <p>The agreement with a legal entity. Administrators, partners and managers can assign; associates have no package access.</p>
        <Steps>
          <li>Open <strong>Client Packages</strong> and choose <strong>Assign package</strong>.</li>
          <li>Pick the <strong>legal entity</strong> and the <strong>base package</strong>. Exactly one base package may be effective at a time.</li>
          <li>Add optional <strong>add-on services</strong> beyond the package.</li>
          <li>Set the <strong>effective period</strong>. You can schedule an assignment to start in the future, or replace a current one.</li>
          <li>Save. To end an agreement, cancel it with a reason.</li>
        </Steps>

        <Note tag="Commercial history is immutable">
          <p>
            Every assignment stores a snapshot of the package name, billing cycle, fee and included and add-on services at the
            moment it was agreed. Later catalogue edits never rewrite that history. INR amounts are stored as integer paise.
          </p>
        </Note>

        <p>
          The register filters by status &mdash; Active, Scheduled, Ended, Cancelled &mdash; and by billing cycle and package,
          and reports monthly recurring value, upcoming renewals and unassigned clients.
        </p>

        <Note tag="What entitlement does" tone="limit">
          <p>
            Work creation is restricted to services the client&rsquo;s <em>effective</em> package entitles. Existing
            obligations remain editable when a new package changes future entitlements. Package management records entitlement
            and agreed pricing; it does not create invoices, post accounting entries, or collect payment.
          </p>
        </Note>

        <p>
          A related read-only view sits at <Path>/settings/package-pricing</Path>: what packages cost to deliver, comparing
          the effort assumed at design against effort actually spent, and naming explicitly which figures are incomplete.
        </p>
      </Chapter>
    </>
  );
}
