import { ensureDatabaseReady } from "@/db";
import { auditLogs } from "@/db/schema";

export interface AuditEntryInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function writeAuditLog(entry: AuditEntryInput): Promise<void> {
  const { db } = await ensureDatabaseReady();
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeState: entry.beforeState ?? null,
    afterState: entry.afterState ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}
