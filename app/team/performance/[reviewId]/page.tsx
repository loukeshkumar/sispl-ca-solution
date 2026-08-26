import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../../lib/auth/authorization";
import { requirePermission } from "../../../../lib/auth/server";
import { indiaDateKey } from "../../../../lib/attendance/calculations";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { periodLabel } from "../../../../lib/performance/review";
import { getReview } from "../../../../lib/performance/repository";
import { ReviewEditor } from "../review-editor";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const session = await requirePermission("dashboard:read", `/team/performance/${reviewId}`);
  const review = await getReview(getDatabase(), session.tenantId, reviewId, indiaDateKey());
  if (!review) notFound();

  const isSubject = review.employeeUserId === session.userId;
  const canReview = hasPermission(session, "performance:review");
  // A review is about one person and written by another. Nobody else has a
  // reason to read it, and a draft is not yet anybody's to read but its author's.
  if (!canReview && !(isSubject && review.status !== "draft")) notFound();

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/team/performance">&larr; Back to reviews</Link>
        <div>
          <p className="eyebrow">PERFORMANCE REVIEW</p>
          <h1>{review.employeeName}</h1>
          <span>{periodLabel(review.periodFrom, review.periodTo)}</span>
        </div>
      </header>

      <ReviewEditor canReview={canReview} isSubject={isSubject} review={review} />
    </main>
  );
}
