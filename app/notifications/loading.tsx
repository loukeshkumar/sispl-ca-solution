import { SkeletonPage } from "../dashboard/skeleton";

/** Route-level fallback for Notifications. */
export default function Loading() {
  return <SkeletonPage kpis={0} />;
}
