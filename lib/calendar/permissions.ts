import { hasPermission, type Permission } from "../auth/authorization";
import { CALENDAR_LAYERS, type CalendarLayer } from "./queue-params";

/**
 * The right each layer is drawn from.
 *
 * The calendar joins registers that are governed separately, and putting them
 * on one grid must not become a way past any of them. Every layer names the
 * permission its own workspace already enforces, so a reader sees on the
 * calendar exactly the set of things they could have found by navigating.
 */
export const LAYER_PERMISSION: Record<CalendarLayer, Permission> = {
  // Work, forecast obligations and holidays are what the dashboard already
  // shows anybody who can read it.
  work: "dashboard:read",
  forecast: "dashboard:read",
  holidays: "dashboard:read",
  // A personal to-do is the reader's own, and only ever their own.
  todos: "dashboard:read",
  tasks: "tasks:read",
  documents: "documents:read",
  invoices: "billing:read",
  dsc: "registers:read",
  notices: "registers:read",
  // Who else is away is team information, not self-service attendance.
  leave: "attendance:review",
};

export function permittedCalendarLayers(subject: Parameters<typeof hasPermission>[0]): CalendarLayer[] {
  return CALENDAR_LAYERS
    .map((layer) => layer.key)
    .filter((layer) => hasPermission(subject, LAYER_PERMISSION[layer]));
}
