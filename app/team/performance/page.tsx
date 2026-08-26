import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { defaultPeriod } from "../../../lib/performance/review";
import { listReviews, listReviewSubjects } from "../../../lib/performance/repository";
import { ReviewList } from "./review-list";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const session = await requirePermission("dashboard:read", "/team/performance");
  const database = getDatabase();
  const todayKey = indiaDateKey();
  const canReview = hasPermission(session, "performance:review");

  const [allReviews, subjects] = await Promise.all([
    listReviews(database, session.tenantId),
    canReview ? listReviewSubjects(database, session.tenantId) : Promise.resolve([]),
  ]);

  // Somebody without the permission sees only reviews about themselves, and only
  // once they have been shared.
  const reviews = canReview
    ? allReviews
    : allReviews.filter((review) => review.employeeUserId === session.userId && review.status !== "draft");

  const drafts = reviews.filter((review) => review.status === "draft").length;
  const awaiting = reviews.filter((review) => review.status === "shared").length;

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=team">&larr; Back to Employees</Link>
        <div>
          <p className="eyebrow">PEOPLE OPERATIONS · PERFORMANCE</p>
          <h1>Performance reviews</h1>
          <span>
            The firm already records what was delivered, what ran late, how much of each person&apos;s time was sold
            and what they were trained on. A review gathers it and asks somebody to put their name to a judgement.
          </span>
        </div>
      </header>

      <section className="package-kpi-grid kpi-grid">
        <article className="surface-card checklist-kpi">
          <span>REVIEWS</span><strong>{String(reviews.length).padStart(2, "0")}</strong>
          <small>{canReview ? "Across the firm" : "About you"}</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>IN DRAFT</span><strong>{String(drafts).padStart(2, "0")}</strong>
          <small>Not yet shown to anyone</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>AWAITING ACKNOWLEDGEMENT</span><strong>{String(awaiting).padStart(2, "0")}</strong>
          <small>Shared, not yet confirmed as read</small>
        </article>
      </section>

      <ReviewList
        canReview={canReview}
        defaults={defaultPeriod(todayKey)}
        reviews={reviews}
        subjects={subjects}
        viewerUserId={session.userId}
      />
    </main>
  );
}
