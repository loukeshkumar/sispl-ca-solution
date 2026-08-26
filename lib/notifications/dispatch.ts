import { and, asc, eq, inArray, lt, or } from "drizzle-orm";

import { employeeProfiles, notificationDeliveries, notifications, tenants, users } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { NotificationChannel } from "./repository";

const MAX_ATTEMPTS = 3;

export type OutboundNotification = {
  channel: NotificationChannel;
  recipientEmail: string;
  recipientName: string;
  recipientPhone: string | null;
  tenantName: string | null;
  title: string;
  body: string;
};

export type NotificationTransport = {
  channel: NotificationChannel;
  send: (message: OutboundNotification) => Promise<void>;
};

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export const logEmailTransport: NotificationTransport = {
  channel: "email",
  async send(message) {
    console.info("notification.email.dispatched", { recipient: maskEmail(message.recipientEmail), title: message.title });
  },
};

export type DispatchSummary = { sent: number; failed: number; retried: number };

export async function dispatchPendingDeliveries(database: DashboardDatabase, transports: NotificationTransport[], limit = 200): Promise<DispatchSummary> {
  const channels = transports.map((transport) => transport.channel);
  const summary: DispatchSummary = { sent: 0, failed: 0, retried: 0 };
  if (channels.length === 0) return summary;
  const pending = await database.select({
    id: notificationDeliveries.id,
    tenantId: notificationDeliveries.tenantId,
    channel: notificationDeliveries.channel,
    attemptCount: notificationDeliveries.attemptCount,
    title: notifications.title,
    body: notifications.body,
    recipientEmail: users.email,
    recipientName: users.fullName,
    recipientPhone: employeeProfiles.mobileNumber,
    tenantName: tenants.displayName,
  }).from(notificationDeliveries)
    .innerJoin(notifications, and(eq(notifications.tenantId, notificationDeliveries.tenantId), eq(notifications.id, notificationDeliveries.notificationId)))
    .innerJoin(users, eq(users.id, notifications.recipientUserId))
    .innerJoin(tenants, eq(tenants.id, notificationDeliveries.tenantId))
    .leftJoin(employeeProfiles, and(eq(employeeProfiles.tenantId, notifications.tenantId), eq(employeeProfiles.userId, notifications.recipientUserId)))
    .where(and(
      eq(notificationDeliveries.status, "pending"),
      inArray(notificationDeliveries.channel, channels),
      or(eq(notificationDeliveries.attemptCount, 0), lt(notificationDeliveries.attemptCount, MAX_ATTEMPTS)),
    ))
    .orderBy(asc(notificationDeliveries.createdAt))
    .limit(limit);
  for (const delivery of pending) {
    const transport = transports.find((candidate) => candidate.channel === delivery.channel);
    if (!transport) continue;
    try {
      await transport.send({
        channel: delivery.channel as NotificationChannel,
        recipientEmail: delivery.recipientEmail,
        recipientName: delivery.recipientName,
        recipientPhone: delivery.recipientPhone,
        tenantName: delivery.tenantName,
        title: delivery.title,
        body: delivery.body,
      });
      await database.update(notificationDeliveries).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(and(eq(notificationDeliveries.id, delivery.id), eq(notificationDeliveries.tenantId, delivery.tenantId)));
      summary.sent += 1;
    } catch (error) {
      const attempts = delivery.attemptCount + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await database.update(notificationDeliveries).set({
        status: exhausted ? "failed" : "pending",
        attemptCount: attempts,
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown dispatch error.",
        updatedAt: new Date(),
      }).where(and(eq(notificationDeliveries.id, delivery.id), eq(notificationDeliveries.tenantId, delivery.tenantId)));
      if (exhausted) summary.failed += 1; else summary.retried += 1;
    }
  }
  return summary;
}
