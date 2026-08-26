import { SkeletonPage } from "./dashboard/skeleton";

/** Route-level fallback: the workspace shape, so nothing shifts when data lands. */
export default function Loading() {
  return <SkeletonPage kpis={6} />;
}
