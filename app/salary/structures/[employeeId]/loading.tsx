import { Skeleton, SkeletonTable, SkeletonText } from "../../../dashboard/skeleton";

/** Route-level fallback for Salary structure: identity header, then the detail panels. */
export default function Loading() {
  return (
    <div className="skeleton-page skeleton-detail" role="status">
      <span className="sr-only">Loading Salary structure…</span>
      <div aria-hidden="true" className="skeleton-detail-header">
        <Skeleton height={56} radius={16} width={56} />
        <div>
          <Skeleton height={11} width={110} />
          <Skeleton height={28} width={240} />
          <Skeleton height={13} width={180} />
        </div>
      </div>
      <div aria-hidden="true" className="skeleton-detail-grid">
        <div className="skeleton-panel">
          <SkeletonText lines={4} />
          <SkeletonTable columns={3} rows={4} />
        </div>
        <div className="skeleton-panel">
          <SkeletonText lines={5} />
        </div>
      </div>
    </div>
  );
}
