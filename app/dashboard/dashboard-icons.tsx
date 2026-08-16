export type DashboardIconName =
  | "overview"
  | "work"
  | "clients"
  | "compliance"
  | "documents"
  | "calendar"
  | "team"
  | "billing"
  | "insights"
  | "search"
  | "bell"
  | "plus"
  | "menu"
  | "close"
  | "chevron"
  | "alert"
  | "clock"
  | "waiting"
  | "review"
  | "arrow"
  | "filter";

const iconPaths: Record<DashboardIconName, string[]> = {
  overview: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  work: ["M9 11l2 2 4-4", "M5 4h14v16H5z", "M9 4V2h6v2"],
  clients: ["M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M22 20v-2a4 4 0 0 0-3-3.87", "M16 2.13a4 4 0 0 1 0 7.75"],
  compliance: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10", "m9 12 2 2 4-4"],
  documents: ["M6 2h9l5 5v15H6z", "M14 2v6h6", "M9 13h6", "M9 17h6"],
  calendar: ["M3 5h18v16H3z", "M16 3v4", "M8 3v4", "M3 10h18"],
  team: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M22 21v-2a4 4 0 0 0-3-3.87"],
  billing: ["M12 1v22", "M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"],
  insights: ["M4 19V9", "M10 19V5", "M16 19v-7", "M22 19V2", "M2 19h22"],
  search: ["M21 21l-4.35-4.35", "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  plus: ["M12 5v14", "M5 12h14"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  chevron: ["m9 18 6-6-6-6"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.6 2-1.2 9.7 17H2.6z"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M12 6v6l4 2"],
  waiting: ["M4 4h16", "M4 20h16", "M7 4c0 4 5 4 5 8s-5 4-5 8", "M17 4c0 4-5 4-5 8s5 4 5 8"],
  review: ["M4 4h16v16H4z", "m8 12 2 2 4-4"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  filter: ["M4 5h16", "M7 12h10", "M10 19h4"],
};

export function DashboardIcon({ name, size = 20 }: { name: DashboardIconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="dashboard-icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {iconPaths[name].map((path) => <path d={path} key={path} />)}
    </svg>
  );
}
