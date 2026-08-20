import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("package workspaces use permission-shaped persistent navigation", async () => {
  const [shell, client, page, authenticatedShell, icons] = await Promise.all([
    read("../app/dashboard/dashboard-shell.tsx"),
    read("../app/dashboard-client.tsx"),
    read("../app/page.tsx"),
    read("../app/authenticated-workspace-shell.tsx"),
    read("../app/dashboard/dashboard-icons.tsx"),
  ]);
  const [navigation, palette] = await Promise.all([
    read("../lib/dashboard/navigation.ts"),
    read("../app/dashboard/command-palette.tsx"),
  ]);
  assert.match(shell, /label: "Package Setup"/);
  assert.match(shell, /label: "Client Packages"/);
  assert.match(shell, /label: "Settings"/);
  assert.match(shell, /isGroup\(entry\)/, "groups render through one path, not a hardcoded block");
  assert.match(shell, /Service Management/);
  // The sidebar and the command palette share one permission rule, so the palette
  // can never offer a workspace the sidebar hides.
  assert.match(navigation, /"Package Setup": "packages:read"/);
  assert.match(navigation, /"Client Packages": "client_packages:manage"/);
  assert.match(navigation, /"Service Management": "services:read"/);
  assert.match(shell, /canOpenWorkspace\(viewer, item\.label\)/);
  assert.match(palette, /canOpenWorkspace\(viewer, item\.label\)/);
  assert.match(palette, /canOpenWorkspace\(viewer, target\)/, "a g-jump must respect the same rule");
  assert.match(client, /"Package Setup": "package-setup"/);
  assert.match(client, /"Client Packages": "client-packages"/);
  assert.match(client, /"Service Management": "service-management"/);
  assert.match(page, /workspace === "package-setup"/);
  assert.match(page, /workspace === "client-packages"/);
  assert.match(page, /workspace === "service-management"/);
  assert.match(page, /clientPackageWorkspace\.todayKey = data\.todayKey/);
  assert.match(authenticatedShell, /"Package Setup": "\/\?workspace=package-setup"/);
  assert.match(authenticatedShell, /"Client Packages": "\/\?workspace=client-packages"/);
  assert.match(authenticatedShell, /"Service Management": "\/\?workspace=service-management"/);
  assert.match(icons, /PackageOpen/);
  assert.match(icons, /Boxes/);
});

test("service and package management expose accessible responsive master-data workflows", async () => {
  const [setup, serviceManagement, assignments, serviceForm, packageForm, assignmentForm, css, packagesLayout, clientPackagesLayout, settingsLayout] = await Promise.all([
    read("../app/dashboard/package-setup-workspace.tsx"),
    read("../app/dashboard/service-management-workspace.tsx"),
    read("../app/dashboard/client-packages-workspace.tsx"),
    read("../app/dashboard/service-management-workspace.tsx"),
    read("../app/packages/package-form.tsx"),
    read("../app/client-packages/assignment-form.tsx"),
    read("../app/globals.css"),
    read("../app/packages/layout.tsx"),
    read("../app/client-packages/layout.tsx"),
    read("../app/settings/master-data/layout.tsx"),
  ]);
  for (const label of ["ACTIVE SERVICES", "ACTIVE PACKAGES", "ARCHIVED PACKAGES", "AVERAGE PACKAGE FEE"]) assert.match(setup, new RegExp(label));
  assert.match(setup, /aria-label="Search packages"/);
  assert.match(setup, /workspace=service-management/);
  // Package add/edit moved into a dialog on the workspace rather than separate routes.
  assert.match(setup, /PackageDialogButton/);
  assert.match(setup, /packageId=\{item\.id\}/, "an existing package must post its id so the save becomes an update");
  for (const label of ["ACTIVE SERVICES", "ARCHIVED SERVICES", "CATEGORIES", "PACKAGE LINKS"]) assert.match(serviceManagement, new RegExp(label));
  assert.match(serviceManagement, /aria-label="Search service master"/);
  assert.match(serviceManagement, /aria-label="Filter services by status"/);
  // Creating a service is now a dialog on the workspace rather than a separate route.
  assert.match(serviceManagement, /onClick=\{\(\) => setDialog\("add"\)\}/);
  assert.match(serviceManagement, /onClick=\{\(\) => setDialog\(service\)\}/);
  for (const label of ["ACTIVE PACKAGES", "UPCOMING RENEWALS", "UNASSIGNED CLIENTS", "MONTHLY RECURRING VALUE"]) assert.match(assignments, new RegExp(label));
  assert.match(assignments, /aria-label="Search client packages"/);
  assert.match(assignments, /id="package-name-filter"/);
  assert.match(assignments, /id="package-cycle-filter"/);
  // Assigning a package moved into a dialog on the workspace rather than a separate route.
  assert.match(assignments, /ClientPackageDialogButton/);
  assert.match(serviceForm, /name="code"/);
  assert.match(serviceForm, /name="category"/);
  assert.match(packageForm, /name="billingCycle"/);
  assert.match(packageForm, /name="serviceIds"/);
  assert.match(assignmentForm, /name="addonServiceIds"/);
  assert.match(assignmentForm, /name="replaceExisting"/);
  assert.match(assignmentForm, /Included services/);
  assert.match(packagesLayout, /WorkspaceRouteFrame active="Package Setup"/);
  assert.match(clientPackagesLayout, /WorkspaceRouteFrame active="Client Packages"/);
  assert.match(settingsLayout, /WorkspaceRouteFrame active="Master Data"/);
  assert.match(css, /\.package-setup-workspace/);
  assert.match(css, /\.client-packages-workspace/);
  assert.match(css, /\.service-management-workspace/);
  assert.match(css, /\.package-form-grid[^}]*min-width:\s*0/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.package-register-head/);
});

test("operator documentation explains package entitlements and their boundaries", async () => {
  const [readme, localSetup, executionPlan] = await Promise.all([
    read("../README.md"),
    read("../LOCAL_SETUP.md"),
    read("../EXECUTION_PLAN.md"),
  ]);

  for (const document of [readme, localSetup, executionPlan]) {
    assert.match(document, /Package Setup/);
    assert.match(document, /Client Packages/);
    assert.match(document, /immutable snapshot/i);
    assert.match(document, /does not (?:create|replace) invoices?/i);
  }
});
