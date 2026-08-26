export type DataSource = "demo" | "postgres";
export type RiskStatus = "Healthy" | "Watch" | "Critical";
export type WorkStatus = "Critical" | "At risk" | "Waiting" | "Review" | "Completed";

export type DashboardRecords = {
  tenant: {
    id: string;
    slug: string;
    displayName: string;
    legalName: string;
  };
  members: Array<{
    id: string;
    fullName: string;
    roleKey: string;
    status: string;
  }>;
  clients: Array<{
    id: string;
    clientGroupId: string;
    legalName: string;
    displayName: string;
    entityType: string;
    maskedPan: string;
    city: string;
    relationshipStart: string;
    ownerName: string;
    riskStatus: Lowercase<RiskStatus>;
    healthScore: number;
    services: string[];
    gstRegistrations: number;
  }>;
  workItems: Array<{
    id: string;
    legalEntityId: string;
    clientName: string;
    serviceKey: string;
    serviceName?: string | null;
    periodKey: string;
    ownerName: string;
    dueDate: string;
    status: "critical" | "at_risk" | "waiting" | "review" | "completed";
    blockerNote: string;
    progress: number;
    missingItems: number;
  }>;
};

export type DashboardClient = {
  id: string;
  name: string;
  displayName: string;
  short: string;
  type: string;
  pan: string;
  gstins: number;
  owner: string;
  services: string[];
  health: number;
  risk: RiskStatus;
  next: string;
  missing: number;
  city: string;
  joined: string;
};

export type DashboardWorkItem = {
  id: string;
  client: string;
  initials: string;
  service: string;
  period: string;
  owner: string;
  ownerInitials: string;
  due: string;
  dueDetail: string;
  dueDate: string;
  status: WorkStatus;
  note: string;
  progress: number;
  color: "violet" | "blue" | "orange" | "green";
};

export type DashboardData = {
  source: DataSource;
  generatedAt: string;
  todayKey: string;
  titleDate: string;
  practice: {
    name: string;
    legalName: string;
    initials: string;
    subtitle: string;
    administratorName: string;
    administratorRole: string;
    administratorInitials: string;
    activeTeamMembers: number;
  };
  metrics: {
    clientGroups: number;
    legalEntities: number;
    gstRegistrations: number;
    healthyPercentage: number;
    attentionClients: number;
    criticalClients: number;
    overdue: number;
    dueThisWeek: number;
    waitingOnClient: number;
    pendingReview: number;
    completed: number;
    onTimeRate: number;
    attentionNeeded: number;
    averageHealth: number;
  };
  clients: DashboardClient[];
  work: DashboardWorkItem[];
  deadlines: Array<{
    id: string;
    day: string;
    month: string;
    label: string;
    summary: string;
    relative: string;
    urgent: boolean;
  }>;
  serviceHealth: Array<{
    name: string;
    value: number;
  }>;
};
