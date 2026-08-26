import { pathToFileURL } from "node:url";

import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import { dispatchPendingDeliveries } from "../../lib/notifications/dispatch";
import { describeTransports, resolveNotificationTransports } from "../../lib/notifications/transports";
import { generateDeadlineNotifications, listActiveTenantIds } from "../../lib/notifications/repository";
import { climbLadder } from "../../lib/escalation/repository";

export async function runNotificationJob() {
  const database = getDatabase();
  const transports = resolveNotificationTransports();
  const tenantIds = await listActiveTenantIds(database);
  const channels = transports.map((transport) => transport.channel);
  let created = 0;
  const escalated = { fired: 0, notified: 0, overtaken: 0 };
  for (const tenantId of tenantIds) {
    created += await generateDeadlineNotifications(database, tenantId, new Date(), channels);
    // After the reminders, because a rung that fires today should read as the
    // escalation of a deadline the assignee has already been told about.
    const climb = await climbLadder(database, tenantId, new Date(), channels);
    escalated.fired += climb.fired;
    escalated.notified += climb.notified;
    escalated.overtaken += climb.overtaken;
  }
  const dispatch = await dispatchPendingDeliveries(database, transports);
  return { tenants: tenantIds.length, created, escalated, transports: describeTransports(), dispatch };
}

async function main() {
  const summary = await runNotificationJob();
  console.info("notification.job.completed", summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("notification.job.failed", { errorType: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "" });
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePostgresPool();
    });
}
