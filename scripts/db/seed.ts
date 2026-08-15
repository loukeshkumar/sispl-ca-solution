import { count, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";

import {
  clientGroups,
  clientServices,
  legalEntities,
  registrations,
  tenantMemberships,
  tenants,
  users,
  workItems,
} from "../../db/schema";
import { demoDashboardRecords, SEEDED_TENANT_ID } from "../../lib/dashboard/fixtures";
import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import type { DashboardDatabase } from "../../lib/dashboard/postgres/repository";

const memberEmails: Record<string, string> = {
  "Loukesh Kumar": "loukesh@example.invalid",
  "Nisha S.": "nisha@example.invalid",
  "Rahul K.": "rahul@example.invalid",
  "Priya M.": "priya@example.invalid",
  "Vikram R.": "vikram@example.invalid",
};

function stableUuid(prefix: string, ordinal: number) {
  return `${prefix}-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

export async function seedDevelopmentData(database: DashboardDatabase) {
  const fixture = demoDashboardRecords;
  const memberIdByName = new Map(fixture.members.map((member) => [member.fullName, member.id]));

  await database.transaction(async (transaction) => {
    await transaction.insert(tenants).values({
      ...fixture.tenant,
      status: "active",
    }).onConflictDoUpdate({
      target: tenants.id,
      set: {
        legalName: fixture.tenant.legalName,
        displayName: fixture.tenant.displayName,
        slug: fixture.tenant.slug,
        status: "active",
        updatedAt: new Date(),
      },
    });

    for (const [index, member] of fixture.members.entries()) {
      await transaction.insert(users).values({
        id: member.id,
        email: memberEmails[member.fullName] ?? `member-${index + 1}@example.invalid`,
        fullName: member.fullName,
        status: "active",
      }).onConflictDoUpdate({
        target: users.id,
        set: {
          email: memberEmails[member.fullName] ?? `member-${index + 1}@example.invalid`,
          fullName: member.fullName,
          status: "active",
        },
      });

      await transaction.insert(tenantMemberships).values({
        id: stableUuid("21000000", index + 1),
        tenantId: fixture.tenant.id,
        userId: member.id,
        roleKey: member.roleKey,
        status: member.status,
      }).onConflictDoUpdate({
        target: tenantMemberships.id,
        set: { roleKey: member.roleKey, status: member.status },
      });
    }

    let serviceOrdinal = 1;
    let registrationOrdinal = 1;
    for (const client of fixture.clients) {
      const ownerId = memberIdByName.get(client.ownerName);
      await transaction.insert(clientGroups).values({
        id: client.clientGroupId,
        tenantId: fixture.tenant.id,
        name: client.legalName,
        relationshipOwnerId: ownerId,
        riskStatus: client.riskStatus,
        healthScore: client.healthScore,
      }).onConflictDoUpdate({
        target: clientGroups.id,
        set: {
          name: client.legalName,
          relationshipOwnerId: ownerId,
          riskStatus: client.riskStatus,
          healthScore: client.healthScore,
          updatedAt: new Date(),
        },
      });

      await transaction.insert(legalEntities).values({
        id: client.id,
        tenantId: fixture.tenant.id,
        clientGroupId: client.clientGroupId,
        legalName: client.legalName,
        displayName: client.displayName,
        entityType: client.entityType,
        maskedPan: client.maskedPan,
        city: client.city,
        relationshipStart: client.relationshipStart,
        status: "active",
      }).onConflictDoUpdate({
        target: legalEntities.id,
        set: {
          legalName: client.legalName,
          displayName: client.displayName,
          entityType: client.entityType,
          maskedPan: client.maskedPan,
          city: client.city,
          relationshipStart: client.relationshipStart,
          status: "active",
          updatedAt: new Date(),
        },
      });

      for (const serviceKey of client.services) {
        await transaction.insert(clientServices).values({
          id: stableUuid("51000000", serviceOrdinal++),
          tenantId: fixture.tenant.id,
          legalEntityId: client.id,
          serviceKey,
          status: "active",
        }).onConflictDoUpdate({
          target: [clientServices.tenantId, clientServices.legalEntityId, clientServices.serviceKey],
          set: { status: "active" },
        });
      }

      for (let registration = 1; registration <= client.gstRegistrations; registration += 1) {
        const registrationKey = `gst-${registration}`;
        await transaction.insert(registrations).values({
          id: stableUuid("52000000", registrationOrdinal++),
          tenantId: fixture.tenant.id,
          legalEntityId: client.id,
          registrationType: "gst",
          registrationKey,
          status: "active",
        }).onConflictDoUpdate({
          target: [registrations.tenantId, registrations.legalEntityId, registrations.registrationKey],
          set: { status: "active" },
        });
      }
    }

    for (const item of fixture.workItems) {
      await transaction.insert(workItems).values({
        id: item.id,
        tenantId: fixture.tenant.id,
        legalEntityId: item.legalEntityId,
        serviceKey: item.serviceKey,
        periodKey: item.periodKey,
        status: item.status,
        statutoryDueDate: item.dueDate,
        internalDueDate: item.dueDate,
        assigneeId: memberIdByName.get(item.ownerName),
        blockerNote: item.blockerNote,
        progress: item.progress,
        missingItemCount: item.missingItems,
      }).onConflictDoUpdate({
        target: workItems.id,
        set: {
          status: item.status,
          statutoryDueDate: item.dueDate,
          internalDueDate: item.dueDate,
          assigneeId: memberIdByName.get(item.ownerName),
          blockerNote: item.blockerNote,
          progress: item.progress,
          missingItemCount: item.missingItems,
          updatedAt: new Date(),
        },
      });
    }
  });
}

export async function getSeedCounts(database: DashboardDatabase, tenantId: string) {
  const [[tenantCount], [groupCount], [entityCount], [workCount]] = await Promise.all([
    database.select({ value: count() }).from(tenants).where(eq(tenants.id, tenantId)),
    database.select({ value: count() }).from(clientGroups).where(eq(clientGroups.tenantId, tenantId)),
    database.select({ value: count() }).from(legalEntities).where(eq(legalEntities.tenantId, tenantId)),
    database.select({ value: count() }).from(workItems).where(eq(workItems.tenantId, tenantId)),
  ]);
  return {
    tenants: tenantCount?.value ?? 0,
    clientGroups: groupCount?.value ?? 0,
    legalEntities: entityCount?.value ?? 0,
    workItems: workCount?.value ?? 0,
  };
}

async function main() {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const counts = await getSeedCounts(database, SEEDED_TENANT_ID);
  console.log(`Seed complete: ${counts.legalEntities} clients and ${counts.workItems} work items.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(() => {
      console.error("Database seed failed. Verify DATABASE_URL and run the migration first.");
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}
