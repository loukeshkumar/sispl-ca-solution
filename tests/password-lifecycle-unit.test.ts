import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * The forced first sign-in and a voluntary change differ only in what sent the
 * person there, so they share one repository call. A second implementation is
 * how one of them ends up forgetting to revoke sessions.
 */
test("both password changes go through one repository function", async () => {
  const [repository, actions] = await Promise.all([
    read("../lib/auth/repository.ts"),
    read("../app/account/change-password/actions.ts"),
  ]);

  assert.match(repository, /export async function changePassword\(/);
  assert.doesNotMatch(repository, /changeRequiredPassword/, "the forced-only variant is gone");

  const start = repository.indexOf("export async function changePassword");
  assert.ok(start > 0, "changePassword is exported");
  const body = repository.slice(start, repository.indexOf("\n}", start));

  // Neither path may keep a session alive that predates the new password.
  assert.match(body, /userSessions\)\.set\(\{ revokedAt: new Date\(\) \}\)/);
  // The update is conditional on the hash it read, so concurrent changes cannot both win.
  assert.match(body, /eq\(userCredentials\.passwordHash, credential\.passwordHash\)/);

  assert.match(actions, /export async function changePasswordAction/);
  assert.match(actions, /export async function changeOwnPasswordAction/);
  const calls = actions.match(/await changePassword\(getDatabase\(\)/g) ?? [];
  assert.equal(calls.length, 2, "both actions call the shared function");
  // Only the forced action may bounce somebody who has nothing to change.
  assert.match(actions, /if \(!session\.mustChangePassword\) redirect\("\/"\);/);
});

/**
 * Expiry is not a reset: it leaves the password the person knows in place and
 * only refuses to let them keep it, so it must never write a new hash.
 */
test("expiring a password keeps the hash and drops the sessions", async () => {
  const repository = await read("../lib/team/repository.ts");
  const start = repository.indexOf("export async function expireEmployeePassword");
  assert.ok(start > 0, "expireEmployeePassword is exported");
  const body = repository.slice(start, repository.indexOf("\n}", start));

  assert.match(body, /mustChangePassword: true/);
  assert.doesNotMatch(body, /passwordHash/, "expiry must not touch the stored password");
  assert.match(body, /userSessions\)\.set\(\{ revokedAt: new Date\(\) \}\)/);
  assert.match(body, /action: "employee\.password_expired"/);

  // The same guards as provisioning: never a Super Admin, an Admin only by one,
  // and never a shared identity another firm also governs.
  assert.match(body, /accessClass === "super_admin"\) throw new TeamRepositoryError\("protected_super_admin"\)/);
  assert.match(body, /accessClass === "admin" && actor\?\.accessClass !== "super_admin"\) throw new TeamRepositoryError\("role_forbidden"\)/);
  assert.match(body, /await assertExclusiveIdentity\(transaction, employee\.userId\)/);
  assert.match(body, /throw new TeamRepositoryError\("no_login"\)/);
});

test("the credential actions are permission-gated and reuse the existing guards", async () => {
  const actions = await read("../app/settings/roles/actions.ts");

  for (const name of ["resetMemberPasswordAction", "expireMemberPasswordAction"]) {
    assert.match(actions, new RegExp(`export async function ${name}`));
  }
  const gates = actions.match(/requirePermission\("team:manage"/g) ?? [];
  assert.equal(gates.length, 2, "both credential actions require team:manage");
  // Reset is the provisioning act that already exists, not a second one.
  assert.match(actions, /provisionEmployeeAccess\(getDatabase\(\)/);
  assert.match(actions, /expireEmployeePassword\(getDatabase\(\)/);
});

test("the people register offers no action it cannot complete", async () => {
  const members = await read("../app/dashboard/role-members.tsx");

  // A Super Admin is refused by the repository, and the actions address an
  // employee profile, so a membership without one has nothing to act on.
  assert.match(members, /accessClass === "super_admin" \|\| !member\.employeeId/);
  assert.match(members, /disabled=\{resetting \|\| expiring \|\| !member\.loginEnabled\}/, "expiry needs an existing login");
  assert.match(members, /temporaryPassword/);
});

test("the roles workspace renders people only where the viewer may manage them", async () => {
  const [workspace, client] = await Promise.all([
    read("../app/dashboard/user-roles-workspace.tsx"),
    read("../app/dashboard-client.tsx"),
  ]);

  assert.match(workspace, /<RoleMembers canManage=\{canManagePeople\} people=\{workspace\.people\}/);
  assert.match(client, /canManagePeople=\{Boolean\(viewer && hasPermission\(viewer, "team:manage"\)\)\}/);
});
