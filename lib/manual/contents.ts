/**
 * The manual's table of contents.
 *
 * The rail and the chapters both render from this list, so a chapter cannot be
 * renamed in one place and stay stale in the other, and a chapter added without
 * an entry here has no number and no way to be reached.
 */
export type ManualSection = { id: string; summary: string; title: string };
export type ManualPart = { label: string; sections: ManualSection[] };

export const manualParts: ManualPart[] = [
  {
    label: "Getting started",
    sections: [
      { id: "what", title: "What SISPL is", summary: "The eleven working areas, and the boundaries the product states about itself." },
      { id: "install", title: "Install and first run", summary: "From a clean machine to a running dashboard with your firm seeded." },
      { id: "signin", title: "Signing in", summary: "Three fields, an eight-hour session, and a forced password change the first time." },
      { id: "around", title: "Getting around", summary: "The shell, the sidebar's four bands, and the three ways to reach anything fast." },
    ],
  },
  {
    label: "Setting the firm up",
    sections: [
      { id: "day-one", title: "Day-one setup order", summary: "Ten steps that must happen in sequence, because each one feeds the next." },
      { id: "services", title: "Services and procedures", summary: "The service master is the spine. Procedures turn a service into a repeatable checklist." },
      { id: "masters", title: "Masters and rates", summary: "Document checklists, leave and shift definitions, charge-out rates, utilisation targets." },
      { id: "roles", title: "Roles and access", summary: "Three access classes, reusable roles, and a version bump that revokes sessions immediately." },
      { id: "employees", title: "Employees", summary: "Add a person, provision their sign-in, then work from Employee 360." },
      { id: "packages", title: "Packages and entitlement", summary: "Compose what you sell, agree it with each entity, and let entitlement gate the work." },
    ],
  },
  {
    label: "Running the practice",
    sections: [
      { id: "clients", title: "Clients", summary: "Add a legal entity, accept the engagement, and work from Client 360." },
      { id: "work", title: "My work and Work 360", summary: "Everything about a statutory obligation, from raising it to marking it complete." },
      { id: "compliance", title: "Compliance", summary: "The obligation register: what is covered, what is not raised, and what is coming." },
      { id: "tasks", title: "Tasks and to-dos", summary: "Accountable office work assigned to a person, and a private reminder register." },
      { id: "documents", title: "Documents", summary: "Ask a client for something, receive it, keep it behind an authenticated door." },
      { id: "calendar", title: "Calendar", summary: "Every deadline the firm is carrying, measured against who is actually in." },
      { id: "registers", title: "Statutory registers", summary: "UDIN, DSC custody, and notices — the three you must be able to hand to a reviewer." },
      { id: "timesheets", title: "Timesheets", summary: "Record effort against a client and a context, then submit the month for approval." },
    ],
  },
  {
    label: "People and money",
    sections: [
      { id: "attendance", title: "Attendance", summary: "Your own attendance, your reportees' approvals, and the firm's monthly cycle." },
      { id: "salary", title: "Salary and payroll", summary: "A five-state maker-checker pipeline that consumes locked attendance." },
      { id: "billing", title: "Billing", summary: "Draft a fee note, issue it, record payment, and hand the ledger to Tally." },
      { id: "insights", title: "Insights", summary: "Deterministic practice signals, each citing the evidence that produced it." },
      { id: "development", title: "Articleship, CPE and reviews", summary: "The three people-development registers under Employee Management." },
      { id: "portal", title: "Client portal", summary: "A separate front door where a contact sees only their own entity." },
    ],
  },
  {
    label: "Keeping it running",
    sections: [
      { id: "jobs", title: "Scheduled jobs", summary: "Three idempotent jobs that generate obligations, accrue leave, and send alerts." },
      { id: "permissions", title: "Permission reference", summary: "Every permission, and what each of the four legacy roles holds." },
      { id: "operations", title: "Operations and backups", summary: "Validating a build, backing up correctly, and the boundaries not to weaken." },
      { id: "troubleshooting", title: "Troubleshooting", summary: "The failures you are most likely to hit, and what each one actually means." },
      { id: "appendix", title: "Appendix", summary: "Commands, environment variables, direct URLs, and the vocabulary." },
    ],
  },
];

export const manualSections: ManualSection[] = manualParts.flatMap((part) => part.sections);

const byId = new Map(manualSections.map((section, index) => [section.id, { ...section, number: index + 1 }]));

/** The chapter as the page renders it: number, title and standfirst in one lookup. */
export function manualChapter(id: string) {
  const chapter = byId.get(id);
  if (!chapter) throw new Error(`Unknown manual chapter: ${id}`);
  return chapter;
}
