import { SkeletonPage } from "../../dashboard/skeleton";

/** Route-level fallback for Master data. */
export default function Loading() {
  return <SkeletonPage kpis={4} />;
}
