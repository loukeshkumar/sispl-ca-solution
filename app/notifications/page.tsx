import Link from "next/link";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { listNotificationWorkspace, type NotificationRow } from "../../lib/notifications/repository";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export const dynamic = "force-dynamic";

function resourceHref(notification: NotificationRow) {
  if (!notification.resourceId) return null;
  switch (notification.resourceType) {
    case "work_item":
      return `/work/${notification.resourceId}`;
    case "office_task":
      return `/tasks/${notification.resourceId}`;
    case "document_request":
      return "/?workspace=documents";
    case "leave_request":
    case "attendance_correction_request":
      return "/?workspace=attendance";
    case "payroll_entry":
      return `/salary/payslips/${notification.resourceId}`;
    case "invoice":
      return `/billing/${notification.resourceId}`;
    default:
      return null;
  }
}

const timestampFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

export default async function NotificationsPage() {
  const session = await requirePermission("dashboard:read", "/notifications");
  const workspace = await listNotificationWorkspace(getDatabase(), session.tenantId, session.userId);
  return (
    <main className="client-page-shell notifications-page-shell">
      <header className="client-page-header">
        <Link href="/">&larr; Back to Overview</Link>
        <div>
          <p className="eyebrow">PRACTICE ALERTS</p>
          <h1>Notifications</h1>
          <span>{workspace.unreadCount > 0 ? `${workspace.unreadCount} unread notification${workspace.unreadCount === 1 ? "" : "s"}.` : "You are all caught up."}</span>
        </div>
      </header>
      {workspace.unreadCount > 0 && (
        <form action={markAllNotificationsReadAction} className="notifications-toolbar">
          <button className="notifications-mark-all" type="submit">Mark all as read</button>
        </form>
      )}
      {workspace.notifications.length === 0 ? (
        <section className="notifications-empty">
          <strong>No notifications yet</strong>
          <p>Deadline alerts and task assignments will appear here as they happen.</p>
        </section>
      ) : (
        <ul className="notifications-list">
          {workspace.notifications.map((notification) => {
            const href = resourceHref(notification);
            const unread = notification.readAt === null;
            return (
              <li className={`notification-item ${unread ? "is-unread" : ""}`} key={notification.id}>
                <div className="notification-item-copy">
                  <strong>{notification.title}</strong>
                  {notification.body && <p>{notification.body}</p>}
                  <small>{timestampFormat.format(new Date(notification.createdAt))}</small>
                </div>
                <div className="notification-item-actions">
                  {href && <Link href={href}>Open</Link>}
                  {unread && (
                    <form action={markNotificationReadAction}>
                      <input name="notificationId" type="hidden" value={notification.id} />
                      <button type="submit">Mark read</button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
