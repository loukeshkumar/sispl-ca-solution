import type { DashboardRecords } from "./types";

export const SEEDED_TENANT_ID = "10000000-0000-4000-8000-000000000001";
export const SEEDED_TENANT_SLUG = "sharma-kumar-ca";

export const demoDashboardRecords: DashboardRecords = {
  tenant: {
    id: SEEDED_TENANT_ID,
    slug: SEEDED_TENANT_SLUG,
    displayName: "Sharma & Kumar",
    legalName: "Sharma & Kumar Chartered Accountants",
  },
  members: [
    { id: "20000000-0000-4000-8000-000000000001", fullName: "Loukesh Kumar", roleKey: "firm_administrator", status: "active" },
    { id: "20000000-0000-4000-8000-000000000002", fullName: "Nisha S.", roleKey: "manager", status: "active" },
    { id: "20000000-0000-4000-8000-000000000003", fullName: "Rahul K.", roleKey: "manager", status: "active" },
    { id: "20000000-0000-4000-8000-000000000004", fullName: "Priya M.", roleKey: "partner", status: "active" },
    { id: "20000000-0000-4000-8000-000000000005", fullName: "Vikram R.", roleKey: "associate", status: "active" },
    { id: "20000000-0000-4000-8000-000000000006", fullName: "Ayesha K.", roleKey: "associate", status: "active" },
  ],
  clients: [
    {
      id: "40000000-0000-4000-8000-000000000001", clientGroupId: "30000000-0000-4000-8000-000000000001",
      legalName: "Aarav Retail Private Limited", displayName: "Aarav Retail Pvt. Ltd.", entityType: "Private Company",
      maskedPan: "AABCA••••F", city: "Patna, Bihar", relationshipStart: "2023-04-01", ownerName: "Nisha S.",
      riskStatus: "watch", healthScore: 74, services: ["GST", "TDS", "Books"], gstRegistrations: 3,
    },
    {
      id: "40000000-0000-4000-8000-000000000002", clientGroupId: "30000000-0000-4000-8000-000000000002",
      legalName: "Koshi Infra LLP", displayName: "Koshi Infra LLP", entityType: "LLP",
      maskedPan: "AAEFK••••Q", city: "Gurugram, Haryana", relationshipStart: "2022-07-01", ownerName: "Rahul K.",
      riskStatus: "critical", healthScore: 58, services: ["GST", "TDS", "Audit", "ROC"], gstRegistrations: 2,
    },
    {
      id: "40000000-0000-4000-8000-000000000003", clientGroupId: "30000000-0000-4000-8000-000000000003",
      legalName: "Brightpath Foundation", displayName: "Brightpath Foundation", entityType: "Trust / NPO",
      maskedPan: "AABTB••••K", city: "New Delhi", relationshipStart: "2024-01-01", ownerName: "Priya M.",
      riskStatus: "healthy", healthScore: 91, services: ["ITR", "Audit", "10B"], gstRegistrations: 1,
    },
    {
      id: "40000000-0000-4000-8000-000000000004", clientGroupId: "30000000-0000-4000-8000-000000000004",
      legalName: "Saanvi Exports", displayName: "Saanvi Exports", entityType: "Partnership",
      maskedPan: "AALFS••••C", city: "Kolkata, West Bengal", relationshipStart: "2021-10-01", ownerName: "Nisha S.",
      riskStatus: "healthy", healthScore: 82, services: ["GST", "LUT", "Books"], gstRegistrations: 4,
    },
    {
      id: "40000000-0000-4000-8000-000000000005", clientGroupId: "30000000-0000-4000-8000-000000000005",
      legalName: "Neelam Foods", displayName: "Neelam Foods", entityType: "Proprietorship",
      maskedPan: "BRQPN••••D", city: "Noida, Uttar Pradesh", relationshipStart: "2025-05-01", ownerName: "Vikram R.",
      riskStatus: "watch", healthScore: 69, services: ["GST", "Books", "ITR"], gstRegistrations: 1,
    },
  ],
  workItems: [
    {
      id: "60000000-0000-4000-8000-000000000001", legalEntityId: "40000000-0000-4000-8000-000000000002",
      clientName: "Koshi Infra LLP", serviceKey: "tds_26q", periodKey: "Q1 · FY 26–27", ownerName: "Rahul K.",
      dueDate: "2026-08-12", status: "critical", blockerNote: "Challan allocation incomplete", progress: 64, missingItems: 0,
    },
    {
      id: "60000000-0000-4000-8000-000000000002", legalEntityId: "40000000-0000-4000-8000-000000000001",
      clientName: "Aarav Retail Pvt. Ltd.", serviceKey: "gstr_3b", periodKey: "July 2026", ownerName: "Nisha S.",
      dueDate: "2026-08-15", status: "at_risk", blockerNote: "18 invoices need reconciliation", progress: 78, missingItems: 0,
    },
    {
      id: "60000000-0000-4000-8000-000000000003", legalEntityId: "40000000-0000-4000-8000-000000000005",
      clientName: "Neelam Foods", serviceKey: "monthly_close", periodKey: "July 2026", ownerName: "Vikram R.",
      // Waits on a recorded dependency the seed raises below, so the fixture
      // demonstrates the model rather than the sentence it replaced.
      dueDate: "2026-08-16", status: "waiting", blockerNote: "Ramesh sends these on Fridays", progress: 46, missingItems: 1,
    },
    {
      id: "60000000-0000-4000-8000-000000000004", legalEntityId: "40000000-0000-4000-8000-000000000003",
      clientName: "Brightpath Foundation", serviceKey: "form_10b", periodKey: "AY 2026–27", ownerName: "Priya M.",
      dueDate: "2026-08-22", status: "review", blockerNote: "Partner review · 2 clauses", progress: 88, missingItems: 0,
    },
  ],
};
