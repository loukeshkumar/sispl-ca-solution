import { SkeletonPage } from "../../dashboard/skeleton";

/** Route-level fallback for Attendance masters. */
export default function Loading() {
  return <SkeletonPage kpis={4} />;
}
