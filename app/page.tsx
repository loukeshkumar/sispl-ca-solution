import DashboardClient from "./dashboard-client";
import DashboardError from "./dashboard-error";
import { resolveDataSource } from "../lib/dashboard/config";
import { getDashboardDataForConfiguredSource } from "../lib/dashboard/provider";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let data;
  try {
    data = await getDashboardDataForConfiguredSource(process.env);
  } catch (error) {
    if (resolveDataSource(process.env) !== "postgres") throw error;
    console.error("PostgreSQL dashboard load failed.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <DashboardError error={error} />;
  }
  return <DashboardClient data={data} />;
}
