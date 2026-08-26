import type { CSSProperties } from "react";

/**
 * Loading placeholders.
 *
 * A skeleton mirrors the shape of what is coming so the layout does not jump
 * when real content lands. It is decorative: the surrounding region carries the
 * announcement, and every skeleton is hidden from assistive technology so a
 * screen reader is not read a wall of empty boxes.
 *
 * The shimmer is suppressed under `prefers-reduced-motion` in the stylesheet.
 */
export function Skeleton({ height, radius, width }: { height?: number | string; radius?: number; width?: number | string }) {
  const style: CSSProperties = {};
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (radius !== undefined) style.borderRadius = `${radius}px`;
  return <span aria-hidden="true" className="skeleton" style={style} />;
}

/** Stacked lines of text. The last line is short, the way a paragraph ends. */
export function SkeletonText({ lines = 3, width = "100%" }: { lines?: number; width?: number | string }) {
  return (
    <span aria-hidden="true" className="skeleton-text" style={{ width: typeof width === "number" ? `${width}px` : width }}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton height={12} key={index} width={index === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

/** A row of KPI tiles — the block that opens most workspaces. */
export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="skeleton-kpi-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <Skeleton height={36} radius={12} width={36} />
          <Skeleton height={11} width="55%" />
          <Skeleton height={26} width="40%" />
        </div>
      ))}
    </div>
  );
}

/** A register or table panel: heading, column head, then rows. */
export function SkeletonTable({ columns = 4, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div aria-hidden="true" className="skeleton-panel">
      <div className="skeleton-panel-heading">
        <Skeleton height={11} width={90} />
        <Skeleton height={18} width={200} />
      </div>
      <div className="skeleton-rows" style={{ "--skeleton-columns": columns } as CSSProperties}>
        {Array.from({ length: rows }, (_, row) => (
          <div className="skeleton-row" key={row}>
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton height={13} key={column} width={column === 0 ? "80%" : "55%"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stand-in for a form while its dropdown data loads. Matching the real field
 * count keeps the dialog from resizing under the pointer as options arrive.
 */
export function SkeletonForm({ fields = 6 }: { fields?: number }) {
  return (
    <div aria-hidden="true" className="skeleton-form">
      {Array.from({ length: fields }, (_, index) => (
        <div className="skeleton-field" key={index}>
          <Skeleton height={11} width={index % 3 === 0 ? 110 : 80} />
          <Skeleton height={42} radius={10} />
        </div>
      ))}
    </div>
  );
}

/** The full-page shape used by route-level loading files. */
export function SkeletonPage({ kpis = 4, title = true }: { kpis?: number; title?: boolean }) {
  return (
    <div className="skeleton-page" role="status">
      <span className="sr-only">Loading…</span>
      {title && (
        <div aria-hidden="true" className="skeleton-page-title">
          <Skeleton height={11} width={120} />
          <Skeleton height={30} width={280} />
          <Skeleton height={13} width={440} />
        </div>
      )}
      {kpis > 0 && <SkeletonKpiRow count={kpis} />}
      <SkeletonTable />
    </div>
  );
}
