import {
  ArrowRight,
  Bell,
  Boxes,
  CalendarCheck,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  Filter,
  Hourglass,
  LayoutDashboard,
  ListTodo,
  ListTree,
  Menu,
  Moon,
  Plus,
  PackageOpen,
  ReceiptIndianRupee,
  Search,
  Settings,
  ShieldCheck,
  SquareCheckBig,
  Sun,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

export type DashboardIconName =
  | "overview"
  | "work"
  | "todo"
  | "attendance"
  | "salary"
  | "clients"
  | "compliance"
  | "documents"
  | "calendar"
  | "team"
  | "billing"
  | "packageSetup"
  | "clientPackages"
  | "settings"
  | "services"
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
  | "filter"
  | "sun"
  | "moon";

const icons: Record<DashboardIconName, LucideIcon> = {
  overview: LayoutDashboard,
  work: ClipboardCheck,
  todo: ListTodo,
  attendance: CalendarCheck,
  salary: ReceiptIndianRupee,
  clients: UsersRound,
  compliance: ShieldCheck,
  documents: FileText,
  calendar: CalendarDays,
  team: UsersRound,
  billing: ReceiptIndianRupee,
  packageSetup: Boxes,
  clientPackages: PackageOpen,
  settings: Settings,
  services: ListTree,
  insights: ChartNoAxesCombined,
  search: Search,
  bell: Bell,
  plus: Plus,
  menu: Menu,
  close: X,
  chevron: ChevronRight,
  alert: TriangleAlert,
  clock: Clock3,
  waiting: Hourglass,
  review: SquareCheckBig,
  arrow: ArrowRight,
  filter: Filter,
  sun: Sun,
  moon: Moon,
};

export function DashboardIcon({ name, size = 20 }: { name: DashboardIconName; size?: number }) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" className="dashboard-icon" focusable="false" size={size} strokeWidth={1.8} />;
}
