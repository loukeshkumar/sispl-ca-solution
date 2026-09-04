import { requirePermission } from "../../lib/auth/server";
import { manualSections } from "../../lib/manual/contents";
import PeopleChapters from "./chapters-people";
import PracticeChapters from "./chapters-practice";
import RunningChapters from "./chapters-running";
import SetupChapters from "./chapters-setup";
import StartChapters from "./chapters-start";
import ManualRail from "./manual-rail";

export const dynamic = "force-dynamic";

/**
 * The operating manual, inside the product it documents.
 *
 * Every signed-in person can read it: a manual you need a permission to open is
 * one the person who most needs it cannot reach. It describes the whole product
 * rather than the reader's own slice, so someone can see what a role they do
 * not hold is responsible for before asking for it.
 */
export default async function ManualPage() {
  await requirePermission("dashboard:read", "/manual");

  return (
    <main className="client-page-shell manual-shell">
      <header className="manual-masthead">
        <p className="eyebrow">OPERATING MANUAL</p>
        <h1>How to run the practice on SISPL</h1>
        <p className="manual-standfirst">
          Every workflow in this application, in the order you would actually do it: from an empty database to a locked
          payroll run.
        </p>
        <p className="manual-masthead-meta">
          {manualSections.length} chapters &middot; the permission tables are generated from the rules the server enforces
        </p>
      </header>

      <div className="manual-body">
        <ManualRail />
        <div className="manual-chapters">
          <StartChapters />
          <SetupChapters />
          <PracticeChapters />
          <PeopleChapters />
          <RunningChapters />
        </div>
      </div>
    </main>
  );
}
