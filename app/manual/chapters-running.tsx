import { hasPermission, permissionDefinitions, roleLabel, roles } from "../../lib/auth/authorization";
import { openWorkspaces, workspacePermissions } from "../../lib/dashboard/navigation";
import { Chapter, Note, Path, TableFrame, Terminal } from "./manual-ui";

/**
 * The permission tables are rendered from the definitions themselves.
 *
 * A hand-copied matrix is a manual that quietly starts lying the first time a
 * permission moves. These read the same source the server checks against, so
 * the page cannot describe a rule the product no longer enforces.
 */
const gatedWorkspaces = Object.entries(workspacePermissions).sort(([a], [b]) => a.localeCompare(b));
const openList = [...openWorkspaces].sort((a, b) => a.localeCompare(b));

/** Chapters 25-29: the jobs, the reference tables, and what to do when it breaks. */
export default function RunningChapters() {
  return (
    <>
      <Chapter id="jobs">
        <Terminal
          lines={[
            "# everything, in the right order",
            "npm run jobs:daily:local",
            "",
            "# or individually",
            "npm run jobs:recurrence:local",
            "npm run jobs:leave-accrual:local",
            "npm run jobs:notifications:local",
          ]}
        />

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Job</th><th>Does</th></tr></thead>
            <tbody>
              <tr>
                <td><strong>recurrence</strong></td>
                <td>Generates upcoming recurring work items from the compliance schedules, per tenant, and expires lapsed DSC certificates. Reports how many of each it created.</td>
              </tr>
              <tr>
                <td><strong>leave-accrual</strong></td>
                <td>
                  Materialises leave entitlement for everyone. Balances are also brought up to date whenever one is read, so
                  this job is not what makes them <em>correct</em> — it is what makes them <em>complete</em>, for the people
                  nobody happened to look at. It also posts the year-end movements: what carries into a new leave year and
                  what lapses when the carry-forward window closes. Nothing else triggers those.
                </td>
              </tr>
              <tr>
                <td><strong>notifications</strong></td>
                <td>Generates deadline notifications per tenant, then climbs the escalation ladder, then dispatches the delivery outbox.</td>
              </tr>
            </tbody>
          </table>
        </TableFrame>

        <Note tag="Safe to re-run">
          <p>Everything these jobs write carries a dedupe key. Running twice in a day, or after a manual run, changes nothing.</p>
        </Note>

        <h3>Notification delivery</h3>
        <p>In-app notifications always work. Outbound delivery is off by default and is enabled per channel.</p>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Setting</th><th>Values</th><th>Notes</th></tr></thead>
            <tbody>
              <tr>
                <td><code>SISPL_EMAIL_TRANSPORT</code></td>
                <td><code>log</code> (default), <code>http</code></td>
                <td>
                  <code>http</code> needs <code>SISPL_EMAIL_ENDPOINT</code>, <code>SISPL_EMAIL_API_KEY</code>,
                  <code> SISPL_EMAIL_FROM_ADDRESS</code> and <code>SISPL_EMAIL_FROM_NAME</code>. Any JSON send API works
                </td>
              </tr>
              <tr>
                <td><code>SISPL_WHATSAPP_TRANSPORT</code></td>
                <td><code>off</code> (default), <code>cloud_api</code></td>
                <td>WhatsApp Business Cloud API. Needs endpoint, access token, template name and country code. <strong>Templates must be pre-approved by Meta</strong></td>
              </tr>
            </tbody>
          </table>
        </TableFrame>

        <Note tag="Failure behaviour" tone="care">
          <p>
            A misconfigured environment <strong>degrades to recording alerts without sending them</strong> rather than
            erroring out. Provider error bodies are redacted before they reach a log.
          </p>
        </Note>
      </Chapter>

      <Chapter id="permissions">
        <p>
          Both tables below are generated from the permission definitions the server checks against, so they describe what the
          product actually enforces today.
        </p>

        <h3>Every permission, by role</h3>

        <TableFrame>
          <table className="manual-table manual-matrix">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Module</th>
                {roles.map((role) => <th key={role}>{roleLabel(role)}</th>)}
              </tr>
            </thead>
            <tbody>
              {permissionDefinitions.map((permission) => (
                <tr key={permission.key}>
                  <td>
                    <code>{permission.key}</code>
                    {"risk" in permission && permission.risk ? <em className="manual-risk"> {permission.risk}</em> : null}
                  </td>
                  <td>{permission.module}</td>
                  {roles.map((role) => (
                    <td className="manual-matrix-cell" key={role}>
                      {hasPermission(role, permission.key)
                        ? <span aria-label="held" className="manual-held">&#10003;</span>
                        : <span aria-label="not held" className="manual-not-held">&middot;</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>

        <Note tag="Reading the matrix">
          <p>
            The firm administrator column holds every permission by definition. <code>roles:manage</code> is the Super Admin
            class boundary: it is assignable to no delegated role, which is why only a Super Admin can create Admin roles or
            assign Admin accounts.
          </p>
        </Note>

        <h3>Which permission opens which workspace</h3>

        <p>
          These {openList.length} destinations are open to everyone signed in, because each one shows you your own work rather
          than the firm&rsquo;s: {openList.map((label, index) => (
            <span key={label}>{index > 0 ? ", " : ""}<strong>{label}</strong></span>
          ))}. Everything else is gated.
        </p>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Workspace</th><th>Needs</th></tr></thead>
            <tbody>
              {gatedWorkspaces.map(([label, permission]) => (
                <tr key={label}><td>{label}</td><td><code>{permission}</code></td></tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Chapter>

      <Chapter id="operations">
        <h3>How the application runs on the server</h3>
        <p>
          On the Windows host, <strong>PM2 owns the Node process</strong> and IIS sits in front of it as a reverse proxy.
          IIS terminates HTTPS for the domain and forwards everything dynamic to <code>127.0.0.1:3022</code>, where
          <code> server.js</code> listens. IIS does not launch the application and does not restart it; that is PM2&rsquo;s
          job, which is the whole reason for the arrangement &mdash; a crash is handled by a process manager whose only
          job that is, rather than by a web server that also has to answer the request.
        </p>

        <Terminal
          lines={[
            "# first time on a host",
            "npm install -g pm2",
            "npm install -g @jessety/pm2-installer   # registers PM2 as a Windows service",
            "",
            "# start, and remember it across reboots",
            "pm2 start ecosystem.config.cjs",
            "pm2 save",
            "",
            "# every deploy after that",
            "git fetch origin main && git reset --hard origin/main",
            "npm ci && npm run build",
            "pm2 reload sispl-ca-solution",
          ]}
        />

        <Note tag="Three things that are easy to miss" tone="care">
          <ul>
            <li>
              IIS needs <strong>Application Request Routing</strong> as well as URL Rewrite. Without ARR a rewrite to an
              <code> http://</code> address does not proxy &mdash; it returns 404, which reads exactly like a routing
              mistake. Confirm with <code>Get-WebGlobalModule</code> and enable proxying at server level.
            </li>
            <li>
              <strong>Plesk&rsquo;s Node.js must be disabled</strong> for the domain. Leaving it on means two things are
              trying to run the same application.
            </li>
            <li>
              Set <code>AUTH_TRUST_PROXY_HEADERS=true</code>. Every request now arrives from <code>127.0.0.1</code>, and
              without it the sign-in rate limiter counts the entire firm as a single client and locks everyone out
              together.
            </li>
          </ul>
        </Note>

        <p>
          <code>pm2 logs sispl-ca-solution</code> shows the application&rsquo;s own output; <code>pm2 status</code> shows
          whether it is up and how many times it has restarted. A restart count that keeps climbing is the signal to read
          the logs rather than restart it again.
        </p>

        <h3>Validation before a deploy</h3>
        <Terminal
          lines={[
            "npm run test:unit",
            "npm run test:integration",
            "npm run build",
            "npm run lint",
            "npm run start   # production server",
          ]}
        />

        <p>
          <strong>The integration suite never touches your development database.</strong> It requires <code>.env</code> or <code>.env.local</code>
          and derives an isolated database whose name must end in <code>_test</code>; by default
          <code> sispl_ca_solution</code> becomes <code>sispl_ca_solution_test</code>. Set <code>DATABASE_URL_TEST</code> only
          when you need a different isolated <code>_test</code> database, and the role must be able to create and drop it.
          That database is dropped and rebuilt on <em>every</em> run, not reused: a run that fails part-way leaves its
          fixtures behind, and a suite whose result depends on what the last run left is one nobody can trust.
        </p>

        <p>
          It exercises connectivity, repeated seeding, concurrent authentication throttles, composite tenant constraints,
          employee access provisioning, task ownership and state transitions, attendance locking, payroll approval,
          publication and payment, payslip privacy, package assignment history, and complete audited client, compliance-work
          and document lifecycles.
        </p>

        <h3>Backups</h3>
        <Note tag="Two things, not one" tone="care">
          <p>
            Back up <strong>PostgreSQL</strong> and <strong><code>.data/documents</code></strong> (or your S3 bucket)
            together. Document metadata alone cannot restore uploaded files &mdash; you would have a register pointing at
            nothing.
          </p>
        </Note>

        <h3>Security boundaries</h3>
        <ul>
          <li>Every tenant-owned query takes and applies an explicit tenant id.</li>
          <li>Dashboard access requires an active user, active tenant membership, a valid role permission, and an unexpired server-side session &mdash; all four.</li>
          <li>
            Routing is deny-by-default. <code>proxy.ts</code> classifies every path as public, staff or portal and redirects
            anonymous requests before the page runs. It checks cookie <em>shape</em> only and never queries the database.
            Per-page <code>requirePermission</code> and <code>requirePortalSession</code> remain the authority: Next.js routes
            Server Functions as POSTs to the page they live on, so proxy coverage can shift when a route moves and must never
            be the only gate.
          </li>
          <li>
            Supporting panels &mdash; document checklist, statutory suggestions, portal contacts, filing acknowledgements,
            bank details &mdash; load through an optional-panel wrapper and degrade to an empty state on failure, so an
            enhancement can never block the workflow it decorates. Only a page&rsquo;s own primary data may throw. Panel
            failures log the panel name and error type, never the query or its parameters.
          </li>
          <li>Credentials and connection strings are never logged.</li>
        </ul>

        <Note tag="Never commit or log" tone="limit">
          <p>
            Real PAN, GSTIN, Aadhaar, banking data, portal passwords, one-time passwords, DSC keys, or database credentials.
            Seeded PAN values are fictitious and masked; seeded GST registrations carry non-statutory internal keys only.
          </p>
        </Note>

        <h3>Behind a reverse proxy</h3>
        <p>
          Set <code>AUTH_TRUST_PROXY_HEADERS=true</code> <em>only</em> behind a proxy that overwrites <code>X-Real-IP</code>
          and <code>X-Forwarded-For</code>. Login throttling always includes a database-backed global limit regardless of this
          setting.
        </p>
      </Chapter>

      <Chapter id="troubleshooting">
        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Symptom</th><th>Cause and fix</th></tr></thead>
            <tbody>
              <tr><td><code>DATABASE_URL is required</code></td><td>Neither <code>.env</code> nor <code>.env.local</code> holds it. Create one from <code>.env.example</code>.</td></tr>
              <tr>
                <td>Database-unavailable screen</td>
                <td>PostgreSQL mode does not substitute demo data. Confirm PostgreSQL is running, the host and port are reachable, and the role can access the database, then run <code>npm run db:check:local</code>.</td>
              </tr>
              <tr><td>Missing tables</td><td>Run <code>npm run db:migrate:local</code>, then the check again.</td></tr>
              <tr><td>A workspace is missing from the sidebar</td><td>Not a bug: your role lacks the permission. Check the permission reference. The command palette hides it too, by design.</td></tr>
              <tr><td>A service will not appear in the work form</td><td>Work creation is restricted to services the client&rsquo;s effective package entitles. Assign or extend the package in Client Packages.</td></tr>
              <tr><td>Cannot create a payroll run</td><td>The attendance month must be locked first: prepare, review, then lock in Attendance.</td></tr>
              <tr><td>Cannot approve a payroll run</td><td>Separation of duties: you prepared or submitted it. Have a partner approve, or use the audited firm-administrator override with a reason.</td></tr>
              <tr><td>An employee cannot reach the workspace</td><td>They were provisioned with a one-time password and must set a permanent one at <Path>/account/change-password</Path> first.</td></tr>
              <tr><td>Someone was signed out unexpectedly</td><td>Their role definition changed. A role update bumps its authorization version and revokes affected sessions so reductions apply immediately.</td></tr>
              <tr><td>A document will not upload</td><td>Extension, MIME type and byte signature must all match, and the file must be 10 MB or under.</td></tr>
              <tr><td>A file preview says <em>No preview</em></td><td>Intentional. That type cannot be previewed safely; download it instead.</td></tr>
              <tr><td>Uploads missing after an abnormal shutdown</td><td>Run <code>npm run db:reconcile-documents:local</code> to reconcile staged uploads.</td></tr>
              <tr>
                <td>Alerts are not being delivered</td>
                <td>Outbound delivery is off by default. Set <code>SISPL_EMAIL_TRANSPORT=http</code> or <code>SISPL_WHATSAPP_TRANSPORT=cloud_api</code> with their required values. A misconfigured environment records alerts without sending them rather than failing loudly.</td>
              </tr>
              <tr><td>Filing status reads <em>unavailable</em></td><td>Correct behaviour. No licensed portal provider is configured, and SISPL will not invent a status.</td></tr>
              <tr><td>A supporting panel is empty</td><td>Optional panels degrade to an empty state on failure so they cannot block the workflow. Check the server log for the panel name and error type.</td></tr>
            </tbody>
          </table>
        </TableFrame>
      </Chapter>

      <Chapter id="appendix">
        <h3>Every npm script</h3>
        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Command</th><th>Does</th></tr></thead>
            <tbody>
              <tr><td><code>npm run dev</code></td><td>Development server</td></tr>
              <tr><td><code>npm run build</code>, <code>npm run start</code></td><td>Production build and server</td></tr>
              <tr><td><code>npm run lint</code></td><td>ESLint</td></tr>
              <tr><td><code>npm run test:unit</code></td><td>Unit tests</td></tr>
              <tr><td><code>npm run test:integration</code></td><td>Integration tests against an isolated <code>_test</code> database</td></tr>
              <tr><td><code>npm run db:setup:local</code></td><td>Migrate, seed and check in one go</td></tr>
              <tr><td><code>npm run db:migrate:local</code></td><td>Apply migrations</td></tr>
              <tr><td><code>npm run db:seed:local</code></td><td>Idempotent seed — the firm, its people, clients and masters</td></tr>
              <tr><td><code>npm run db:seed:demo</code></td><td>Demonstration history for the seeded firm: a closed attendance month carried through to a paid payroll run, invoices, documents, timesheets and registers. Opt-in and never part of <code>db:setup:local</code>, so a real firm never receives invented payroll runs and invoices</td></tr>
              <tr><td><code>npm run db:sample</code></td><td>Everything above in one line &mdash; migrate, seed, check, then the demonstration history. For standing up a demonstration host from an empty database. It writes the fictitious firm into whatever <code>DATABASE_URL</code> points at, so it is not the command to run against a real firm&rsquo;s data</td></tr>
              <tr><td><code>npm run db:check:local</code></td><td>Redacted connection check</td></tr>
              <tr><td><code>npm run db:generate</code></td><td>Generate a Drizzle migration from the schema</td></tr>
              <tr><td><code>npm run db:reconcile-documents:local</code></td><td>Reconcile interrupted staged uploads</td></tr>
              <tr><td><code>npm run db:backfill-leave-ledger:local</code></td><td>Backfill the leave ledger</td></tr>
              <tr><td><code>npm run storage:check:local</code></td><td>S3 credentials and round-trip check</td></tr>
              <tr><td><code>npm run jobs:daily:local</code></td><td>Recurrence, leave accrual and notifications</td></tr>
              <tr><td><code>npm run jobs:recurrence:local</code></td><td>Generate recurring obligations, expire lapsed DSCs</td></tr>
              <tr><td><code>npm run jobs:leave-accrual:local</code></td><td>Accrue leave, post year-end movements</td></tr>
              <tr><td><code>npm run jobs:notifications:local</code></td><td>Deadline alerts, escalation, dispatch</td></tr>
            </tbody>
          </table>
        </TableFrame>

        <h3>Environment variables</h3>
        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Variable</th><th>Default</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr><td><code>SISPL_DATA_SOURCE</code></td><td><code>demo</code></td><td><code>postgres</code> for the real database</td></tr>
              <tr><td><code>DATABASE_URL</code></td><td>—</td><td>Required in postgres mode</td></tr>
              <tr><td><code>DATABASE_URL_TEST</code></td><td>derived</td><td>Only when a different <code>_test</code> database is needed</td></tr>
              <tr><td><code>SISPL_PUBLIC_URL</code></td><td><code>http://localhost:3000</code></td><td>Public base URL</td></tr>
              <tr><td><code>AUTH_TRUST_PROXY_HEADERS</code></td><td><code>false</code></td><td>Keep false unless behind a trusted proxy</td></tr>
              <tr><td><code>SISPL_DEV_ADMIN_PASSWORD</code></td><td>—</td><td>Seed password override, set before the first seed</td></tr>
              <tr><td><code>SISPL_DOCUMENT_STORAGE</code></td><td><code>local</code></td><td><code>s3</code> for private object storage</td></tr>
              <tr><td><code>SISPL_S3_*</code></td><td>—</td><td>Endpoint, bucket, region, keys, path style, prefix</td></tr>
              <tr><td><code>SISPL_EMAIL_TRANSPORT</code></td><td><code>log</code></td><td><code>http</code> to actually send</td></tr>
              <tr><td><code>SISPL_WHATSAPP_TRANSPORT</code></td><td><code>off</code></td><td><code>cloud_api</code> to actually send</td></tr>
            </tbody>
          </table>
        </TableFrame>

        <h3>Pages reached only by URL</h3>
        <p>These have no sidebar entry. Type the path directly.</p>
        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Path</th><th>Page</th></tr></thead>
            <tbody>
              <tr><td><Path>/settings/compliance</Path></td><td>Compliance schedules, client schedules and the escalation ladder, also linked from Service Management</td></tr>
              <tr><td><Path>/settings/package-pricing</Path></td><td>What packages cost to deliver</td></tr>
              <tr><td><Path>/timesheets/periods</Path></td><td>Monthly timesheet approval</td></tr>
              <tr><td><Path>/billing/from-time</Path></td><td>Bill from recorded time</td></tr>
              <tr><td><Path>/notifications</Path></td><td>Practice alerts, also reached from the header bell</td></tr>
              <tr><td><Path>/account/change-password</Path></td><td>Change your own password</td></tr>
            </tbody>
          </table>
        </TableFrame>

        <h3>Glossary</h3>
        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>Term</th><th>Means</th></tr></thead>
            <tbody>
              <tr><td><strong>Tenant</strong></td><td>One firm. Every record belongs to exactly one, and every query is scoped to it.</td></tr>
              <tr><td><strong>Legal entity</strong></td><td>A client. The unit that packages, work, documents, invoices and portal access all attach to.</td></tr>
              <tr><td><strong>Work item</strong></td><td>One statutory obligation for one client, one service, one period.</td></tr>
              <tr><td><strong>Statutory due date</strong></td><td>The legal deadline.</td></tr>
              <tr><td><strong>Internal due date</strong></td><td>The date the firm manages to. Never later than the statutory date, and the date the queue counts down to.</td></tr>
              <tr><td><strong>Entitlement</strong></td><td>What a client&rsquo;s effective package permits. Work can only be raised for entitled services.</td></tr>
              <tr><td><strong>Snapshot</strong></td><td>The frozen copy of package name, cycle, fee and services stored on an assignment, so later catalogue edits never rewrite commercial history.</td></tr>
              <tr><td><strong>Locked month</strong></td><td>An attendance period that can no longer change, and what payroll consumes.</td></tr>
              <tr><td><strong>Maker-checker</strong></td><td>The rule that whoever prepares a payroll run cannot approve it.</td></tr>
              <tr><td><strong>Paise</strong></td><td>All INR values are stored as integers in paise, never floats.</td></tr>
              <tr><td><strong>Burn</strong></td><td>Logged time against budget, as a percentage. Reads <em>No budget</em> when the service had no standard effort.</td></tr>
              <tr><td><strong>Dedupe key</strong></td><td>What makes the scheduled jobs safe to run twice.</td></tr>
            </tbody>
          </table>
        </TableFrame>
      </Chapter>
    </>
  );
}
