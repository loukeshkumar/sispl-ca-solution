import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("client and work creation consume the tenant service master", async () => {
  const [clientForm, clientActions, clientRepository, workRepository, workValidation, packageForm] = await Promise.all([
    read("../app/clients/client-form.tsx"),
    read("../app/clients/actions.ts"),
    read("../lib/clients/repository.ts"),
    read("../lib/work/repository.ts"),
    read("../lib/work/validation.ts"),
    read("../app/packages/package-form.tsx"),
  ]);

  // Client add/edit moved into a dialog; options load from the action instead of a page.
  assert.match(clientActions, /listActiveServiceOptions/);
  assert.match(clientActions, /export async function loadClientFormOptions/);
  assert.match(clientActions, /export async function saveClientAction/);
  assert.match(clientForm, /services\.map\(\(service\)/);
  assert.doesNotMatch(clientForm, /clientServiceOptions/);
  assert.match(clientRepository, /assertActiveServices/);
  assert.match(clientRepository, /eq\(serviceCatalog\.tenantId, tenantId\)/);
  assert.match(workRepository, /listEntitledServices/);
  assert.match(workRepository, /services: \[\.\.\.services\.values\(\)\]/);
  assert.doesNotMatch(workRepository, /workServiceOptions\.filter/);
  assert.match(workValidation, /SERVICE_KEY_PATTERN/);
  assert.match(packageForm, /services\.map\(\(service\)/);
});

test("service mutations use dedicated permissions and are driven from the workspace dialog", async () => {
  // Service add/edit moved from dedicated pages into the workspace modal.
  const [actions, workspace] = await Promise.all([
    read("../app/packages/actions.ts"),
    read("../app/dashboard/service-management-workspace.tsx"),
  ]);
  assert.match(actions, /export async function saveServiceAction/);
  assert.match(actions, /requirePermission\("services:manage"/);
  assert.match(actions, /workspace=service-management/);
  assert.match(workspace, /FormDialog/, "service editing must use the shared modal primitive");
  assert.match(workspace, /saveServiceAction/);
  assert.match(workspace, /name="serviceId"/, "an existing service must post its id so the save becomes an update");
});
