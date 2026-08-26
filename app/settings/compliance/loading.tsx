import { SkeletonPage } from "../../dashboard/skeleton";

/** Route-level fallback for Compliance schedules. */
export default function Loading() {
  return <SkeletonPage kpis={4} />;
}
