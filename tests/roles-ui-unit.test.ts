import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Settings exposes User Roles Management through the persistent workspace shell", async () => {
  const [shell, client, page, workspace, roleLayout] = await Promise.all([
    read("app/dashboard/dashboard-shell.tsx"), read("app/dashboard-client.tsx"), read("app/page.tsx"),
    read("app/dashboard/user-roles-workspace.tsx"), read("app/settings/roles/layout.tsx"),
  ]);
  const navigation = await read("lib/dashboard/navigation.ts");
  assert.match(shell, /User Roles Management/);
  // Role management sits under Employee Management; the gate is the shared rule.
  assert.match(navigation, /"User Roles Management": "roles:read"/);
  assert.match(shell, /label: "Employee Management"/);
  assert.match(shell, /label: "User Roles Management" \}/);
  assert.match(client, /"User Roles Management": "user-roles"/);
  assert.match(page, /listRoleManagementWorkspace/);
  assert.match(workspace, /Full firm access, fixed by the system/);
  assert.match(workspace, /Admin roles/);
  assert.match(workspace, /Employee categories/);
  assert.match(roleLayout, /WorkspaceRouteFrame active="User Roles Management"/);
});

test("role mutations are Super Admin-only and expose an accessible permission matrix", async () => {
  // The matrix moved from a page form into the dialog; the guarantees are unchanged.
  const [actions, form, repository] = await Promise.all([
    read("app/settings/roles/actions.ts"), read("app/dashboard/role-dialog.tsx"), read("lib/roles/repository.ts"),
  ]);
  assert.match(actions, /requireSuperAdmin/);
  assert.match(form, /<fieldset/);
  assert.match(form, /<legend>/);
  assert.match(form, /name="permissions"/);
  assert.match(form, /FormDialog/, "role editing must use the shared modal primitive");
  assert.match(repository, /eq\(tenantMemberships\.accessClass, "super_admin"\)/);
  assert.match(repository, /authorizationVersion/);
  assert.match(repository, /revokedAt/);
});
