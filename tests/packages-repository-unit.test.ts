import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { DashboardDatabase } from "../lib/dashboard/postgres/repository";
import {
  assignClientPackage,
  cancelClientPackage,
  createPackage,
  createService,
  getAssignmentDetail,
  getPackageForEdit,
  getServiceForEdit,
  listClientPackageWorkspace,
  listPackageSetupWorkspace,
  updatePackage,
  updateService,
} from "../lib/packages/repository";

const database = {} as DashboardDatabase;

test("every package repository operation rejects missing tenant identity before querying", async () => {
  await assert.rejects(() => listPackageSetupWorkspace(database, ""), /Tenant is required/);
  await assert.rejects(() => listClientPackageWorkspace(database, ""), /Tenant is required/);
  await assert.rejects(() => getServiceForEdit(database, "", "service"), /Tenant is required/);
  await assert.rejects(() => getPackageForEdit(database, "", "package"), /Tenant is required/);
  await assert.rejects(() => getAssignmentDetail(database, "", "assignment"), /Tenant is required/);
});

test("package repository exposes transactional catalogue and immutable assignment lifecycles", async () => {
  assert.equal(typeof createService, "function");
  assert.equal(typeof updateService, "function");
  assert.equal(typeof createPackage, "function");
  assert.equal(typeof updatePackage, "function");
  assert.equal(typeof assignClientPackage, "function");
  assert.equal(typeof cancelClientPackage, "function");

  const source = await readFile(new URL("../lib/packages/repository.ts", import.meta.url), "utf8");
  for (const value of [
    "packageCodeSnapshot", "packageNameSnapshot", "billingCycleSnapshot",
    "standardFeePaiseSnapshot", "agreedFeePaiseSnapshot", "serviceCodeSnapshot",
    "serviceNameSnapshot", "serviceCategorySnapshot",
  ]) assert.match(source, new RegExp(value));
  assert.match(source, /database\.transaction/);
  assert.match(source, /\.for\("update"/);
  assert.match(source, /eq\(clientPackageAssignments\.tenantId, tenantId\)/);
  assert.match(source, /eq\(serviceCatalog\.tenantId, tenantId\)/);
  assert.match(source, /eq\(servicePackages\.tenantId, tenantId\)/);
  assert.match(source, /clientServices/);
});

test("work creation consumes date-effective package entitlement with legacy fallback", async () => {
  const [workSource, formSource] = await Promise.all([
    readFile(new URL("../lib/work/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/work/work-form.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(workSource, /isServiceEntitled/);
  assert.match(workSource, /workServiceEntitlementCode/);
  assert.match(workSource, /invalid_service/);
  assert.match(formSource, /selectedClient\?\.services/);
  // The empty state is split in two, because "pick a client" and "this client
  // has no package services" need different fixes from the user.
  assert.match(formSource, /servicePlaceholder/);
  assert.match(formSource, /emptyServiceMessage/);
});

test("client editing preserves package-controlled service entitlements", async () => {
  const [repository, form] = await Promise.all([
    readFile(new URL("../lib/clients/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/clients/client-form.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(repository, /clientPackageAssignments/);
  assert.match(repository, /hasPackageHistory/);
  assert.match(form, /Package-controlled services/);
  assert.match(form, /workspace=client-packages/);
});
