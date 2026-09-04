import { Chapter, Fields, Note, Path, Steps, TableFrame, Terminal } from "./manual-ui";

/** Chapters 1-4: what the product is, how to stand it up, and how to move around it. */
export default function StartChapters() {
  return (
    <>
      <Chapter id="what">
        <p>
          SISPL is a multi-tenant web application. One installation serves one or more firms; every record belongs to a
          <strong> tenant</strong> (your firm), and every query is scoped to it. Within a firm, what you can see is decided by
          your role&rsquo;s permissions, evaluated on the server for every request.
        </p>

        <h3>The eleven working areas</h3>

        <TableFrame>
          <table className="manual-table">
            <thead>
              <tr><th>Area</th><th>What it holds</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>Clients</strong></td><td>Legal entities, registrations, relationship health, engagement acceptance, engagement letters, portal access</td></tr>
              <tr><td><strong>Delivery</strong></td><td>Compliance work items with statutory and internal deadlines, procedure steps, review, dependencies, filing evidence</td></tr>
              <tr><td><strong>Tasks &amp; to-dos</strong></td><td>Office tasks assigned to people, and a private personal reminder register</td></tr>
              <tr><td><strong>Documents</strong></td><td>Requests to clients, authenticated uploads and downloads, a per-client library</td></tr>
              <tr><td><strong>Registers</strong></td><td>UDIN register, DSC custody with a movement trail, statutory notices with response deadlines</td></tr>
              <tr><td><strong>Timesheets</strong></td><td>Time against clients, obligations and tasks; monthly submission and approval</td></tr>
              <tr><td><strong>Attendance</strong></td><td>Check-in and check-out, leave and correction requests, approvals, monthly lock</td></tr>
              <tr><td><strong>Salary</strong></td><td>Effective-dated structures, attendance-linked payroll, maker-checker approval, payslips, bank file</td></tr>
              <tr><td><strong>Packages</strong></td><td>Service master, packages, client agreements, entitlement enforcement</td></tr>
              <tr><td><strong>Billing</strong></td><td>Draft invoices, issue, payment, cancellation, receivables, Tally export</td></tr>
              <tr><td><strong>People development</strong></td><td>Articleship register, training and CPE, performance reviews</td></tr>
            </tbody>
          </table>
        </TableFrame>

        <h3>What it deliberately does not do</h3>

        <p>
          Reading this list before you start saves a lot of misplaced expectation. These are stated product boundaries, not
          gaps waiting to be filled by a setting.
        </p>

        <Note tag="Not implemented" tone="limit">
          <ul>
            <li>
              <strong>No portal connections.</strong> SISPL does not connect to GSTN, the income-tax portal, TRACES or MCA.
              Filing acknowledgements are entered by the firm as evidence. Until a licensed provider is configured, the status
              resolver reports <em>unavailable</em> rather than inventing a status.
            </li>
            <li>
              <strong>UDINs are recorded, not generated.</strong> You generate the number on the ICAI portal and record it
              here. SISPL does not validate it with ICAI.
            </li>
            <li>
              <strong>DSC custody only.</strong> The register records who holds a token and when it expires. PINs, passwords
              and private keys are rejected by validation and must never be entered.
            </li>
            <li>
              <strong>Statutory amounts are suggested, not computed for you.</strong> PF, ESI and professional tax are
              suggested from effective-dated rate versions and must be reviewed. Income tax and TDS are entirely manual. Due
              dates and invoice tax amounts are entered and verified by the firm.
            </li>
            <li>
              <strong>No money moves.</strong> Payroll produces a NEFT/RTGS instruction CSV. SISPL never connects to a bank.
              Money moves only when a person uploads and authorises that file at the bank. There is no payment collection
              either.
            </li>
            <li><strong>Tally is one-way.</strong> The export produces import-ready XML. There is no live connection and no import back into SISPL.</li>
            <li>
              <strong>No AI.</strong> Insights are deterministic rules recomputed on load, each citing the evidence that
              produced it &mdash; not predictions, not model output. There is no document OCR, no extraction, and no
              natural-language query layer.
            </li>
            <li><strong>Outbound delivery is off by default.</strong> Email and WhatsApp transports exist but ship disabled; the default records alerts without sending them.</li>
            <li><strong>Seeded compliance schedules and rates are firm-reviewable defaults</strong>, not statutory advice.</li>
          </ul>
        </Note>
      </Chapter>

      <Chapter id="install">
        <h3>Prerequisites</h3>
        <ul>
          <li><strong>Node.js 22.13</strong> or newer, which the package enforces</li>
          <li><strong>npm</strong></li>
          <li><strong>PostgreSQL 16</strong> or newer</li>
          <li>A PostgreSQL role allowed to create tables in the target database</li>
        </ul>
        <p>The commands work identically in PowerShell, Command Prompt, macOS, Linux and WSL.</p>

        <h3>Two data modes</h3>
        <p>The same source tree runs in two explicit modes, chosen by one environment variable.</p>

        <Fields
          rows={[
            { term: "demo", note: "The default. Deterministic fictitious records, no PostgreSQL, no login. Use it to look around before committing to a database." },
            { term: "postgres", note: "Reads your local database and requires authentication. If configuration, connection or a query fails it shows a retry screen — it never silently falls back to demo data." },
          ]}
        />

        <h3>Procedure</h3>

        <Steps>
          <li>
            <strong>Install dependencies.</strong>
            <Terminal lines={["npm ci"]} />
          </li>
          <li>
            <strong>Create an empty database</strong> from <code>psql</code> as an administrative role.
            <Terminal lines={["create database sispl_ca_solution;"]} />
          </li>
          <li>
            <strong>Create your local environment file.</strong> Copy <code>.env.example</code> to <code>.env.local</code> and
            replace only the placeholders. <code>.env.local</code> is git-ignored and must stay that way.
            <Terminal
              lines={[
                "SISPL_DATA_SOURCE=postgres",
                "DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/sispl_ca_solution",
                "SISPL_PUBLIC_URL=http://localhost:3000",
                "AUTH_TRUST_PROXY_HEADERS=false",
              ]}
            />
            <p>
              If the password contains URL-reserved characters, percent-encode it. The <code>connection_limit</code> and
              <code> pool_timeout</code> query parameters are stripped from the URL and applied as pool settings.
            </p>
          </li>
          <li>
            <strong>Optionally set your own first password</strong> before the first seed, so the documented development
            password is never in play.
            <Terminal lines={["SISPL_DEV_ADMIN_PASSWORD=a-unique-password-of-at-least-12-characters"]} />
          </li>
          <li>
            <strong>Migrate, seed and check</strong> in one command.
            <Terminal lines={["npm run db:setup:local"]} />
            <p>
              This applies the reviewed Drizzle migrations, seeds one fictitious firm, then reports connectivity. The check
              prints only host, port, database name, PostgreSQL version and required-table status &mdash; never credentials.
              The three steps are also available separately as <code>db:migrate:local</code>, <code>db:seed:local</code> and
              <code> db:check:local</code>. Re-running the seed does not duplicate rows and does not overwrite an existing
              credential.
            </p>
          </li>
          <li>
            <strong>Start the application.</strong>
            <Terminal lines={["npm run dev"]} />
            <p>
              Open the URL Next.js prints, normally <code>http://localhost:3000</code>. In PostgreSQL mode the dashboard badge
              reads <strong>LOCAL DATABASE</strong>.
            </p>
          </li>
        </Steps>

        <h3>What the seed creates</h3>
        <p>
          One fictitious firm &mdash; <strong>Sharma &amp; Kumar</strong>, firm ID <code>sharma-kumar-ca</code> &mdash; with
          five clients, four compliance work items, five employee profiles and work profiles, one Bihar attendance policy,
          five office tasks, six leave types, a general shift, a document checklist and a default service catalogue covering
          GST, ITR, TDS, ROC, audit and bookkeeping.
        </p>

        <Note tag="Not fabricated" tone="care">
          <p>
            The seed creates <strong>no</strong> attendance history, salary values, payroll runs, payslips, package
            assignments or commercial fees. Those are yours to enter, which is why the walkthroughs in this manual build them.
          </p>
        </Note>

        <h3>Document storage</h3>
        <p>
          Uploads land in <code>.data/documents</code>, outside <code>public</code> and git-ignored.
          <strong> Back that directory up together with PostgreSQL</strong> &mdash; document metadata alone cannot restore
          files.
        </p>
        <p>
          For private object storage instead, set <code>SISPL_DOCUMENT_STORAGE=s3</code> with the <code>SISPL_S3_*</code>
          values, then verify a full stage, commit, read and delete round trip.
        </p>
        <Terminal lines={["npm run storage:check:local"]} />
        <p>
          The bucket must stay private: files are always streamed through the authenticated download route, never a public or
          pre-signed URL. Switching modes does not migrate existing files, so move them first. After an abnormal shutdown,
          reconcile interrupted staged uploads.
        </p>
        <Terminal lines={["npm run db:reconcile-documents:local"]} />
      </Chapter>

      <Chapter id="signin">
        <p>
          PostgreSQL mode requires a database-backed login. The sign-in form at <Path>/login</Path> asks for three things.
        </p>

        <Fields
          rows={[
            { term: "Firm ID", note: <>The tenant slug. For the seeded firm, <code>sharma-kumar-ca</code></> },
            { term: "Email address", note: <>The seeded administrator is <code>loukesh@example.invalid</code></> },
            { term: "Password", note: <>The development default is <code>SISPL-Local-2026!</code>, or whatever you set in <code>SISPL_DEV_ADMIN_PASSWORD</code> before the first seed</> },
          ]}
        />

        <p>
          Passwords are stored only as salted scrypt hashes. The session cookie is HTTP-only, same-site and time-limited, and
          holds only a random opaque token &mdash; only its SHA-256 hash is stored server-side. Sessions last eight hours.
        </p>

        <h3>First sign-in for a new employee</h3>
        <p>
          Anyone provisioned by an administrator receives a one-time random password and is sent to
          <Path>/account/change-password</Path> before they can reach the workspace. They cannot skip it: every protected route
          redirects there until a permanent password is set.
        </p>

        <h3>Login protection</h3>
        <ul>
          <li>Atomic account lockout after repeated failures</li>
          <li>Database-backed per-network and global request limits</li>
          <li>
            Client-address headers from a proxy are trusted <em>only</em> when <code>AUTH_TRUST_PROXY_HEADERS=true</code>,
            which must stay <code>false</code> for direct local development and be enabled only behind a reverse proxy that
            overwrites <code>X-Real-IP</code> and <code>X-Forwarded-For</code>
          </li>
        </ul>

        <Note tag="Two separate front doors">
          <p>
            Staff sign in at <Path>/login</Path>. Client contacts sign in at <Path>/portal/login</Path> with their own
            credentials, sessions and cookie. A portal token can never open a staff session and a staff token can never open a
            portal session. Routing is deny-by-default: only <code>/login</code>, <code>/forbidden</code> and
            <code> /portal/login</code> are public; everything else is classified as staff or portal and redirects anonymous
            requests before the page runs.
          </p>
        </Note>
      </Chapter>

      <Chapter id="around">
        <p>
          Most of SISPL lives on one page. The dashboard renders a <strong>workspace</strong> at a time; switching workspace
          changes the URL to <code>/?workspace=&hellip;</code>, so any view is bookmarkable. A few destinations, this manual
          among them, are their own routes and navigate as ordinary links.
        </p>

        <h3>The sidebar</h3>
        <p>
          Destinations are grouped into four coloured bands, by what you are doing rather than which module owns the screen.
          Destinations your role cannot open are hidden entirely; the sidebar and the command palette apply the same rule, so
          the palette never offers a door you cannot open.
        </p>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Band</th><th>Destinations</th></tr></thead>
            <tbody>
              <tr><td><strong>Practice</strong></td><td>Overview &middot; Insights &middot; Calendar</td></tr>
              <tr><td><strong>Delivery</strong></td><td>My work &middot; Tasks &middot; To-do &middot; Compliance &middot; Documents &middot; Registers</td></tr>
              <tr><td><strong>Clients &amp; revenue</strong></td><td>Client Management (Clients, Client Documents) &middot; Package Setup &middot; Client Packages &middot; Billing</td></tr>
              <tr>
                <td><strong>Firm</strong></td>
                <td>
                  Employee Management (Employees, Articleship, Training &amp; CPE, Performance, Attendance, Salary,
                  Timesheets) &middot; Settings (Service Management, Work Procedures, Master Data, Attendance Masters, Rate
                  Card, Utilisation Targets, User Roles Management) &middot; Manual
                </td>
              </tr>
            </tbody>
          </table>
        </TableFrame>

        <p>The sidebar collapses to an icon rail and the choice is remembered in browser storage. On a narrow screen it becomes a menu.</p>

        <h3>The three fast paths</h3>

        <Steps>
          <li>
            <strong>Global search</strong> &mdash; the search box in the header. It searches clients, work, tasks, documents,
            invoices and people at once. Arrow keys move, <kbd>Enter</kbd> opens, <kbd>Esc</kbd> closes.
          </li>
          <li>
            <strong>Command palette</strong> &mdash; <kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>/</kbd>. Type a workspace name and
            press <kbd>Enter</kbd>. It lists only destinations you may open.
          </li>
          <li>
            <strong>Create menu</strong> &mdash; the <em>Create new</em> button. One menu for the six things you start most
            often, each shown only if you hold the permission: <strong>Client</strong>, <strong>Work item</strong>,
            <strong> Task</strong>, <strong>Document request</strong>, <strong>Invoice</strong> and <strong>Employee</strong>.
          </li>
        </Steps>

        <h3>Keyboard shortcuts</h3>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Keys</th><th>Does</th></tr></thead>
            <tbody>
              <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>/</kbd></td><td>Open the command palette</td></tr>
              <tr><td><kbd>g</kbd> then a letter</td><td>Jump straight to a workspace</td></tr>
              <tr><td><kbd>?</kbd></td><td>Show the shortcut list</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Close a dialog or the palette</td></tr>
            </tbody>
          </table>
        </TableFrame>

        <p>The <kbd>g</kbd> jumps, in the mail-client idiom. Press <kbd>g</kbd>, then within 1.2 seconds:</p>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Key</th><th>Workspace</th><th>Key</th><th>Workspace</th></tr></thead>
            <tbody>
              <tr><td><kbd>g</kbd> <kbd>o</kbd></td><td>Overview</td><td><kbd>g</kbd> <kbd>d</kbd></td><td>Documents</td></tr>
              <tr><td><kbd>g</kbd> <kbd>w</kbd></td><td>My work</td><td><kbd>g</kbd> <kbd>e</kbd></td><td>Employees</td></tr>
              <tr><td><kbd>g</kbd> <kbd>t</kbd></td><td>Tasks</td><td><kbd>g</kbd> <kbd>a</kbd></td><td>Attendance</td></tr>
              <tr><td><kbd>g</kbd> <kbd>c</kbd></td><td>Clients</td><td><kbd>g</kbd> <kbd>b</kbd></td><td>Billing</td></tr>
              <tr><td><kbd>g</kbd> <kbd>i</kbd></td><td>Insights</td><td /><td /></tr>
            </tbody>
          </table>
        </TableFrame>

        <p>
          Shortcuts stay quiet while you are typing into a field and while a dialog is open, so a <kbd>/</kbd> inside a
          client&rsquo;s legal name is just a slash.
        </p>

        <h3>Header controls</h3>
        <ul>
          <li><strong>Notifications</strong> &mdash; the bell carries an unread count and opens <Path>/notifications</Path>, where you can mark one read or mark all read</li>
          <li><strong>Theme toggle</strong> &mdash; light or dark</li>
          <li><strong>Your account</strong> &mdash; change password, sign out</li>
        </ul>

        <h3>Overview</h3>
        <p>
          The landing workspace: a priority queue ranked by deadline and dependency, with a filter across All, Overdue, Due
          this week, Critical, At risk, Waiting and Review, a search box, an <em>Attention needed</em> panel, your to-do
          widget and an export action. <em>View all work</em> takes you to My work.
        </p>
      </Chapter>
    </>
  );
}
