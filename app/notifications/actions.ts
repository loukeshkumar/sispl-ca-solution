"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { markAllNotificationsRead, markNotificationRead } from "../../lib/notifications/repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function markNotificationReadAction(formData: FormData) {
  const session = await requirePermission("dashboard:read", "/notifications");
  const notificationId = String(formData.get("notificationId") ?? "");
  if (UUID_PATTERN.test(notificationId)) {
    await markNotificationRead(getDatabase(), session.tenantId, session.userId, notificationId);
  }
  revalidatePath("/notifications");
  revalidatePath("/");
  redirect("/notifications");
}

export async function markAllNotificationsReadAction() {
  const session = await requirePermission("dashboard:read", "/notifications");
  await markAllNotificationsRead(getDatabase(), session.tenantId, session.userId);
  revalidatePath("/notifications");
  revalidatePath("/");
  redirect("/notifications");
}
