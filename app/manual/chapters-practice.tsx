import { Chapter, Fields, Note, Path, Pipeline, Steps, TableFrame } from "./manual-ui";

/** Chapters 11-18: the day-to-day work of the practice. */
export default function PracticeChapters() {
  return (
    <>
      <Chapter id="clients">
        <h3>Adding a client</h3>
        <Steps>
          <li>Open <strong>Clients</strong> with <kbd>g</kbd> <kbd>c</kbd> and choose <strong>Add client</strong>.</li>
          <li>
            Complete the <strong>identity</strong> section.
            <Fields
              rows={[
                { term: "Legal name", note: "The registered name" },
                { term: "Display name", note: "What the firm calls them day to day" },
                { term: "Entity type", note: "Private Company, LLP, Trust or NPO, Partnership, Proprietorship" },
                { term: "Masked PAN", note: <>Masked form only, for example <code>AABCA&bull;&bull;&bull;&bull;F</code></> },
                { term: "GST registrations", note: "Active registrations, held as internal non-statutory keys" },
                { term: "City / location", note: "Where the entity operates" },
              ]}
            />
          </li>
          <li><strong>Services</strong> &mdash; tick the active services. Commercial terms are set separately in Client Packages, and the form links there.</li>
          <li><strong>Portfolio health</strong> &mdash; relationship owner, relationship since, relationship status, risk status and health score.</li>
          <li>Save.</li>
        </Steps>

        <Note tag="Validation" tone="limit">
          <p>
            Client writes <strong>reject complete PAN values</strong>, validate that the relationship owner is a tenant-owned
            member, and create an audit event. Real PAN, GSTIN, Aadhaar and banking data must never be committed or logged.
          </p>
        </Note>

        <h3>The Clients workspace</h3>
        <p>
          A portfolio list with a health segment filter and a search box, beside a Client 360 panel for the selected client.
          There is also an import action. Each row shows next obligation, next action, owner and relationship health.
        </p>

        <h3>Client 360</h3>
        <p>
          Open a client to get the full record at <Path>/clients/&lt;id&gt;</Path>: practice profile, registrations,
          relationship, engagements, active services, open work, missing items and health score, plus two actions on the
          header &mdash; <strong>Create work item</strong> and <strong>Request document</strong> &mdash; both prefilled with
          this client.
        </p>

        <h4>Acceptance and engagement letters</h4>
        <p>The acceptance panel records client acceptance properly.</p>
        <Steps>
          <li><strong>Record each check</strong> with the date it was performed and its outcome: cleared, concern raised, or not applicable.</li>
          <li><strong>Decide</strong>: accept this client, or decline, with a note.</li>
          <li>
            <strong>Save an engagement letter</strong>: which services it covers, the fee basis (fixed retainer, hourly, per
            service or other), the period it covers from and until, when it was issued and when it was signed. Its state reads
            as draft, issued but not signed, or signed.
          </li>
        </Steps>

        <h4>Portal access</h4>
        <p>
          The client portal panel provisions a contact: enter contact name and email, and SISPL issues a one-time password,
          revokes any prior portal sessions, and forces a password change. Revoking ends live sessions immediately. See the
          client portal chapter for what the contact then sees.
        </p>

        <h4>Archiving</h4>
        <p>Archive a client from the record when the relationship ends. History is kept.</p>
      </Chapter>

      <Chapter id="work">
        <h3>Raising a work item</h3>
        <Steps>
          <li>From <strong>My work</strong>, Client 360, or the create menu, choose <strong>Create work item</strong>.</li>
          <li>
            Set the <strong>client and filing</strong>.
            <Fields
              rows={[
                { term: "Client", note: "Active clients only. Only services the client's package entitles are offered" },
                { term: "Service / form", note: "GST, ITR, TDS, ROC, Audit, Books" },
                { term: "Period", note: "Free text, for example August 2026 or Q2 - FY 2026-27" },
              ]}
            />
          </li>
          <li>
            Set the <strong>due dates</strong>: the statutory due date, and the internal due date the firm actually manages to.
            <Note tag="Rule" tone="care">
              <p>The internal due date must not exceed the statutory deadline. Deadline order is validated on save.</p>
            </Note>
          </li>
          <li><strong>Assignee</strong> and <strong>reviewer</strong> &mdash; both must be active tenant members, and separation of duties is enforced.</li>
          <li><strong>Budget in minutes</strong> &mdash; leave blank to inherit the service standard.</li>
          <li>
            <strong>Delivery state</strong> &mdash; status (Critical, At risk, Waiting, Review, Completed), progress
            percentage, and a blocker or dependency note recording what is needed, from whom, and by when.
          </li>
          <li>Save. An audit event is written.</li>
        </Steps>

        <h3>The My work queue</h3>

        <h4>Three scopes</h4>
        <ul>
          <li><strong>Assigned to me</strong> &mdash; the default, your own work</li>
          <li><strong>I review</strong> &mdash; what is waiting on your review</li>
          <li><strong>Whole firm</strong> &mdash; everything</li>
        </ul>

        <h4>Three views</h4>
        <ul>
          <li><strong>Deadline list</strong> &mdash; rows grouped by urgency: overdue against the managed date, due today, due this week, later. Each group carries a count before you read anything.</li>
          <li><strong>Status board</strong> &mdash; columns for Critical, At risk, Waiting and Review.</li>
          <li><strong>Capacity</strong> &mdash; four weeks of committed effort per person against availability derived from their configured shift, and how many of their items carry no budget.</li>
        </ul>

        <h4>Filters, sorts and presets</h4>
        <p>
          Filter across All, Overdue, Due this week, Critical, At risk, Waiting and Review. Sort by deadline, progress or
          client. Five presets are ready-made: my overdue, awaiting client, ready for my review, over budget, and unassigned.
        </p>

        <Note tag="Every view is a URL">
          <p>
            Filter, sort, view and scope state all live in the query string. Any view can be bookmarked or pasted to a
            colleague, and the presets are ordinary shareable links.
          </p>
        </Note>

        <h4>What a row tells you</h4>
        <p>
          Client and service, period, blocker note, progress bar, outstanding-items count, logged time against budget with a
          burn percentage or <em>No budget</em>, owner, the date the firm manages to with the statutory date shown underneath
          when they differ, a countdown chip, and status.
        </p>

        <h3>Bulk actions</h3>
        <p>With <code>work:write</code>, tick rows and use the bulk bar to reassign, change reviewer, shift internal dates, or change status.</p>
        <Note tag="How bulk behaves" tone="care">
          <p>
            The whole selection is validated first, so skipped items are reported with a reason rather than failing silently,
            and <strong>each changed item writes its own audit event</strong>. Bulk actions cannot mark work completed:
            completion is deliberate and individual.
          </p>
        </Note>

        <h3>Work 360</h3>
        <p>
          Open any item at <Path>/work/&lt;id&gt;</Path>. The header carries client, service, period, assignee, reviewer,
          status, both due dates, outstanding count and progress, plus flags for an extended due date, escalation, and a
          handover note. Editing reopens the same form.
        </p>

        <h4>Procedure panel</h4>
        <p>
          The published steps for the service. For each: mark done, undo, or record why the step does not apply. If no
          procedure is published you see <em>No procedure for this service</em>.
        </p>

        <h4>Review panel</h4>
        <Steps>
          <li>The preparer submits for review, with a note on what changed since the last round.</li>
          <li>The named reviewer sees it under <em>I review</em> and in the <em>Ready for my review</em> preset.</li>
          <li>The reviewer either approves, or returns it with a reason &mdash; <em>a return with no reason tells the preparer nothing</em>.</li>
        </Steps>

        <h4>Waiting on &mdash; dependencies</h4>
        <p>Record what the item is blocked by, so a stalled obligation reads as blocked rather than late. Choose the kind:</p>
        <ul>
          <li><strong>Client deliverable</strong> &mdash; links to an open document request</li>
          <li><strong>Predecessor work</strong> &mdash; another obligation that must come first</li>
          <li><strong>External party</strong> &mdash; a bank, a previous auditor, a portal. Name who owes it and what</li>
        </ul>
        <p>Set what is awaited and the date expected by, then clear it by marking it arrived and recording what arrived.</p>

        <h4>Filing acknowledgements</h4>
        <p>
          Portal evidence, entered by the firm: return or form, period, portal, ARN or acknowledgement number, filed-on date,
          portal status and remarks. This is the evidence trail. SISPL does not fetch it.
        </p>

        <h4>Completing</h4>
        <p>Marking complete closes the obligation. Closure is an atomic transition with its own audit event.</p>
      </Chapter>

      <Chapter id="compliance">
        <p>Where My work is personal, Compliance is portfolio-wide control. Three views:</p>

        <TableFrame>
          <table className="manual-table">
            <thead><tr><th>View</th><th>Shows</th></tr></thead>
            <tbody>
              <tr><td><strong>Obligation register</strong></td><td>Every obligation, filterable by status and service, with presets</td></tr>
              <tr><td><strong>Client &times; period</strong></td><td>A matrix of coverage: which client has which obligation raised for which period</td></tr>
              <tr><td><strong>Not raised</strong></td><td>Coverage gaps — obligations the schedule expects that nobody has raised</td></tr>
            </tbody>
          </table>
        </TableFrame>

        <p>
          The header reports overdue, due this week, ready for review, and not-raised counts. Panels beside the register cover
          portfolio health, service readiness, and a deadline radar of upcoming controls.
        </p>

        <h3>Closing a coverage gap</h3>
        <Steps>
          <li>Switch to the <strong>Not raised</strong> view.</li>
          <li>Find the client and period with no obligation raised.</li>
          <li>Choose <strong>Raise obligation</strong>. The work item form opens prefilled from the gap.</li>
          <li>Confirm the dates and assignment, then save.</li>
        </Steps>

        <p>
          Alternatively, <strong>Add obligation</strong> raises one from scratch. Recurring obligations are generated
          automatically by the recurrence job from the compliance schedules; the gap view is for what the schedule does not
          cover.
        </p>
      </Chapter>

      <Chapter id="tasks">
        <h3>Tasks</h3>
        <p>Office delivery work: anything that is not itself a statutory obligation but has an owner and a date.</p>

        <Steps>
          <li>Open <strong>Tasks</strong> with <kbd>g</kbd> <kbd>t</kbd> and choose <strong>Assign task</strong>.</li>
          <li>
            Write the <strong>task definition</strong>.
            <Fields
              rows={[
                { term: "Task title", note: "For example, Prepare GST reconciliation exceptions" },
                { term: "Description", note: "Expected outcome, supporting details, completion criteria" },
                { term: "Client context", note: "Optional, or a general office task" },
                { term: "Compliance work", note: "Optional link to a work item" },
              ]}
            />
          </li>
          <li>Set <strong>assignment and outcome</strong>: assignee, optional reviewer, due date, priority (low, normal, high, urgent), estimate in minutes, status and blocker note.</li>
          <li>Save. Assignees must be tenant-owned, and the reviewer must differ from the assignee.</li>
        </Steps>

        <p>
          The workspace mirrors My work: list, board and capacity views, scope tabs, presets, filters by status and priority,
          sorting by deadline, priority or assignee, and a search across task, employee and client. Header metrics cover
          overdue, due today, in review and waiting. Bulk actions apply to a validated selection.
        </p>

        <p>
          <strong>Task 360</strong> at <Path>/tasks/&lt;id&gt;</Path> shows assigned by, assignee, reviewer, client, linked
          compliance work, due date, status, expected outcome and the blocker or handoff note.
        </p>

        <Note tag="Scope">
          <p>
            Managers and above assign and review. An associate holds <code>tasks:update:own</code> &mdash; they can update
            tasks assigned to them, and nothing else.
          </p>
        </Note>

        <h3>To-do &mdash; your private register</h3>
        <p>Personal reminders. Nobody else sees them.</p>
        <ul>
          <li><strong>Quick add</strong> &mdash; type a title and press enter</li>
          <li><strong>Add detailed to-do</strong> &mdash; title, notes, category, due date, due time, priority, and a repeat rule of none, daily, weekly or monthly</li>
          <li>Views: list, or the next four weeks. Filter by category; search title, notes or category</li>
          <li>Per item: mark complete, reopen, edit, archive. Categories can be renamed in bulk</li>
          <li>Header counts: overdue, today, upcoming, open, completed</li>
        </ul>
        <p>Your open to-dos also surface as a widget on Overview.</p>
      </Chapter>

      <Chapter id="documents">
        <h3>Raising a request</h3>
        <Steps>
          <li>From <strong>Documents</strong> with <kbd>g</kbd> <kbd>d</kbd>, Client 360, or the create menu, choose <strong>New request</strong>.</li>
          <li>
            Pick a <strong>checklist entry</strong> from Master Data. The title, standard instructions and due date fill in
            from the entry&rsquo;s lead time. Free text remains available for anything non-standard.
          </li>
          <li>Set the client, the work item it supports, and who it is required by.</li>
          <li>Save. The request appears in the register and, if the client has portal access, on their portal.</li>
        </Steps>

        <h3>Receiving a file</h3>
        <Steps>
          <li>Find the request and choose <strong>Receive</strong>, or use <strong>Upload document</strong> directly.</li>
          <li>Attach the file and save. The request moves to received.</li>
        </Steps>

        <Note tag="Upload rules" tone="limit">
          <ul>
            <li>Extension, MIME type <em>and</em> byte signature must all match</li>
            <li>Maximum 10 MB per file</li>
            <li>Files are staged privately, then promoted on commit</li>
            <li>Downloads are served as attachments only, and only after document-read authorization and tenant-scoped authentication</li>
            <li>Object-storage keys are tenant-scoped and reference-validated, and buckets must stay private — there is no public or pre-signed URL</li>
          </ul>
        </Note>

        <h3>Working the register</h3>
        <p>
          Two layouts, by request and by client. Filter across all, open, overdue, due today, due this week, later, received,
          cancelled and needs chasing. Search by title, client or work item. Header counts cover open requests, needs chasing,
          received and files.
        </p>
        <p>
          Per request: view with an inline preview where the type allows it (otherwise <em>No preview</em>, deliberately,
          rather than rendering something unsafe), download, or cancel. Bulk cancellation is available for a selection.
        </p>

        <h3>Client Documents &mdash; the library</h3>
        <p>
          A separate workspace: files by client, newest first, searchable by file name, service or uploader, with the same
          view and download actions and an upload button. Use the register when you are chasing; use the library when you are
          looking something up.
        </p>
      </Chapter>

      <Chapter id="calendar">
        <p>
          Three views &mdash; month, week and agenda &mdash; over layers you can show and hide, each layer gated by the
          permission that owns it. Filter by client and owner, including unassigned, search by title, client or owner, and
          step through periods.
        </p>

        <p>Header counts cover overdue, due today, the next seven days, and unassigned. Two panels earn their place:</p>
        <ul>
          <li><strong>Still open</strong> &mdash; the overdue backlog carried over from before today</li>
          <li><strong>Pressure points</strong> &mdash; days under strain: deadlines measured against actual availability, so you can see the days that will not fit before you reach them</li>
        </ul>

        <p>From a day drawer you can act directly: complete an item, reassign it, or dismiss it from view. Adding a deadline raises new work in place.</p>

        <h3>Export to your mail client</h3>
        <p>
          The export action downloads an <code>.ics</code> file. It honours the filters currently on screen, and the same
          permission gate, so what you download is what you were shown and nothing wider. The feed spans three months back and
          twelve months forward, deliberately wider than any on-screen view, so a file read in a mail client weeks later has
          not gone stale.
        </p>
      </Chapter>

      <Chapter id="registers">
        <p>
          Open <strong>Registers</strong> and pick one. Each has a layout toggle between by entry and by client, search,
          filters by status and urgency, sorting, and pagination. Header figures cover active UDINs, DSCs expiring, open
          notices and what needs action. Clicking an entry opens a detail drawer.
        </p>

        <h3>UDIN register</h3>
        <p>Recording a UDIN captures a number you generated on the ICAI portal.</p>
        <Fields
          rows={[
            { term: "UDIN", note: "The number itself" },
            { term: "Client", note: "The legal entity" },
            { term: "Signing member", note: "The member who signed" },
            { term: "Membership number", note: "Their ICAI membership number" },
            { term: "Document type", note: "And a document description" },
            { term: "Generated on", note: "The date the number was generated" },
            { term: "Linked obligation", note: "Optional work item" },
          ]}
        />
        <p>An entry can be revoked with a revocation reason. SISPL neither generates nor validates UDINs with ICAI.</p>

        <h3>DSC custody register</h3>
        <p>
          Registering a DSC records the token: certificate holder, class, serial or token identifier, issuing authority, valid
          from and valid until, custodian, storage location and notes.
        </p>
        <p>
          <strong>Record a movement</strong> each time custody changes &mdash; that trail is the point of the register. The
          recurrence job expires lapsed certificates automatically. Bulk actions apply to a selection.
        </p>

        <Note tag="Never enter" tone="limit">
          <p>PINs, passwords and private keys are rejected by validation. The register records <strong>custody and expiry only</strong>.</p>
        </Note>

        <h3>Statutory notices</h3>
        <p>
          Logging a notice records client, authority, notice number, section, subject, notice date, received-on date, response
          due date, owner and notes. Update the status as you work it. The register sorts by response deadline, flags what is
          overdue or due today, and supports bulk status changes.
        </p>

        <h3>Exporting</h3>
        <p>
          Each register exports to CSV. The export includes <strong>every row</strong>, not just the page you are viewing: a
          partial file would be read as the complete record. It requires <code>registers:read</code>.
        </p>
      </Chapter>

      <Chapter id="timesheets">
        <h3>Recording time</h3>
        <Steps>
          <li>Open <strong>Timesheets</strong> and use quick entry.</li>
          <li>
            Fill it in.
            <Fields
              rows={[
                { term: "Date", note: "The day the work was done" },
                { term: "Client", note: "The legal entity" },
                { term: "Context", note: "An obligation, a task, or none" },
                { term: "Time", note: <>Entered as <code>1:30</code> or <code>90</code></> },
                { term: "Type", note: "Billable or non-billable" },
                { term: "What was done", note: "For example, reviewed July GST reconciliation" },
              ]}
            />
          </li>
          <li>Choose <strong>Record time</strong>. Delete an entry you made in error.</li>
        </Steps>

        <p>
          Your header reads my time this month, my billable share, firm time, unbilled value and margin this month. The
          engagement effort panel breaks time down by client with time spent, cost, unbilled value and margin. Those figures
          come from the Rate Card.
        </p>

        <h3>Monthly submission</h3>
        <p><Path>/timesheets/periods</Path> handles monthly approval.</p>

        <Pipeline
          states={[
            { step: "You", label: "Submit period" },
            { step: "Reviewer", label: "Approve or return" },
            { step: "Reviewer", label: "Reopen if needed" },
          ]}
        />

        <p>
          A reviewer with <code>timesheets:manage</code> decides submitted periods, can reopen a decided one, and can record a
          late entry against a period that has already closed, so the record stays honest rather than convenient.
        </p>

        <Note tag="Boundary" tone="limit">
          <p>
            Timesheets record effort for review. They do not price engagements or post to billing on their own; see the
            billing chapter for turning unbilled time into an invoice.
          </p>
        </Note>
      </Chapter>
    </>
  );
}
