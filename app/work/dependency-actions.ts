"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { clearDependency, DependencyError, raiseDependency } from "../../lib/dependencies/repository";

export type DependencyActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = () => {
  revalidatePath("/work/[workItemId]", "page");
  revalidatePath("/");
};

const failure = (error: unknown): DependencyActionState => ({
  error: error instanceof DependencyError ? error.message : "That dependency could not be recorded. Refresh and try again.",
  fieldErrors: {},
});

const optionalId = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return UUID_PATTERN.test(text) ? text : null;
};

export async function raiseDependencyAction(
  _previous: DependencyActionState,
  formData: FormData,
): Promise<DependencyActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const workItemId = String(formData.get("workItemId") ?? "");
  if (!UUID_PATTERN.test(workItemId)) return { error: "That obligation could not be found.", fieldErrors: {} };

  try {
    await raiseDependency(getDatabase(), session.tenantId, session.userId, workItemId, {
      dependsOnWorkItemId: optionalId(formData.get("dependsOnWorkItemId")),
      documentRequestId: optionalId(formData.get("documentRequestId")),
      expectedOn: String(formData.get("expectedOn") ?? ""),
      externalParty: String(formData.get("externalParty") ?? "") || null,
      kind: String(formData.get("kind") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

/**
 * Only external waits are cleared here. A client deliverable is cleared by the
 * document arriving and a predecessor by that work completing, so offering a
 * button for either would let the two records disagree.
 */
export async function clearDependencyAction(
  _previous: DependencyActionState,
  formData: FormData,
): Promise<DependencyActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const dependencyId = String(formData.get("dependencyId") ?? "");
  if (!UUID_PATTERN.test(dependencyId)) return { error: "That dependency could not be found.", fieldErrors: {} };

  try {
    await clearDependency(getDatabase(), session.tenantId, session.userId, dependencyId, String(formData.get("note") ?? ""));
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
