import { desc, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  auditLogs,
  evOwnerVerifications,
  facilities,
  notifications,
  operators,
  payments,
  platformSettings,
  refunds,
  reservations,
  supportTickets,
  users,
} from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { publishPlatformEvent } from "@/lib/events";

export async function getAdminOverview() {
  const state = await ensureDatabaseReady();
  const { db } = state;

  const [
    userRows,
    operatorRows,
    ownerVerifRows,
    facilityRows,
    reservationRows,
    paymentRows,
    refundRows,
    ticketRows,
    auditRows,
    settingRows,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    db.select().from(operators).orderBy(desc(operators.createdAt)),
    db.select().from(evOwnerVerifications).orderBy(desc(evOwnerVerifications.createdAt)),
    db.select().from(facilities).orderBy(desc(facilities.createdAt)),
    db.select().from(reservations).orderBy(desc(reservations.createdAt)).limit(50),
    db.select().from(payments).orderBy(desc(payments.createdAt)).limit(50),
    db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(50),
    db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(50),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(80),
    db.select().from(platformSettings),
  ]);

  const now = Date.now();
  const freshnessReport = facilityRows.map((f) => {
    const ageMin = Math.round((now - new Date(f.availabilityUpdatedAt).getTime()) / 60_000);
    return {
      facilityId: f.id,
      name: f.name,
      dataSourceType: f.dataSourceType,
      status: f.status,
      lastUpdatedAt: f.availabilityUpdatedAt,
      ageMinutes: ageMin,
      isStale: ageMin > 15,
    };
  });

  const totalCapturedPaise = paymentRows
    .filter((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED")
    .reduce((sum, p) => sum + p.amountPaise, 0);

  const totalRefundedPaise = refundRows
    .filter((r) => r.status === "PROCESSED")
    .reduce((sum, r) => sum + r.amountPaise, 0);

  return {
    metrics: {
      totalUsers: userRows.length,
      totalOperators: operatorRows.length,
      pendingFacilityApprovals: facilityRows.filter((f) => f.status === "PENDING_APPROVAL").length,
      activeFacilities: facilityRows.filter((f) => f.status === "ACTIVE").length,
      totalReservations: reservationRows.length,
      totalCapturedPaise,
      totalRefundedPaise,
      openDisputes: ticketRows.filter((t) => t.status === "OPEN" || t.status === "IN_REVIEW").length,
    },
    systemHealth: {
      databaseMode: state.mode,
      postgisEnabled: state.hasPostgis,
      paymentGatewayMode: process.env.PAYMENT_GATEWAY_MODE || "sandbox",
      status: "HEALTHY",
      checkedAt: new Date().toISOString(),
    },
    users: userRows,
    operators: operatorRows,
    ownerVerifications: ownerVerifRows,
    facilities: facilityRows,
    reservations: reservationRows,
    payments: paymentRows,
    refunds: refundRows,
    tickets: ticketRows,
    auditLogs: auditRows,
    settings: settingRows,
    freshnessReport,
  };
}

export async function reviewFacilityApproval(params: {
  admin: SessionUser;
  facilityId: string;
  decision: "ACTIVE" | "SUSPENDED" | "REJECTED";
  reason?: string;
}) {
  const { db } = await ensureDatabaseReady();
  const [fac] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, params.facilityId))
    .limit(1);

  if (!fac) throw new AppError(404, "NOT_FOUND", "Facility not found");

  const [updated] = await db
    .update(facilities)
    .set({ status: params.decision, updatedAt: new Date() })
    .where(eq(facilities.id, fac.id))
    .returning();

  const [op] = await db
    .select()
    .from(operators)
    .where(eq(operators.id, fac.operatorId))
    .limit(1);

  if (op) {
    await db.insert(notifications).values({
      userId: op.ownerUserId,
      type: "FACILITY_REVIEWED",
      title: `Facility "${fac.name}" ${params.decision}`,
      body: params.reason || `Administrator set facility status to ${params.decision}.`,
    });
  }

  await writeAuditLog({
    actorUserId: params.admin.id,
    actorRole: params.admin.role,
    action: `FACILITY_${params.decision}`,
    entityType: "FACILITY",
    entityId: fac.id,
    beforeState: { status: fac.status },
    afterState: { status: params.decision, reason: params.reason ?? null },
  });

  publishPlatformEvent({
    type: "FACILITY_STATUS_CHANGED",
    facilityId: fac.id,
    source: "ADMIN",
    payload: { facilityId: fac.id, status: params.decision },
  });

  return updated;
}

export async function reviewOperatorStatus(params: {
  admin: SessionUser;
  operatorId: string;
  status: "APPROVED" | "SUSPENDED" | "REJECTED";
  notes?: string;
}) {
  const { db } = await ensureDatabaseReady();
  const [op] = await db
    .select()
    .from(operators)
    .where(eq(operators.id, params.operatorId))
    .limit(1);

  if (!op) throw new AppError(404, "NOT_FOUND", "Operator not found");

  const [updated] = await db
    .update(operators)
    .set({
      status: params.status,
      verifiedAt: params.status === "APPROVED" ? new Date() : op.verifiedAt,
      verifiedByUserId: params.admin.id,
      notes: params.notes ?? op.notes,
      updatedAt: new Date(),
    })
    .where(eq(operators.id, op.id))
    .returning();

  await db
    .update(evOwnerVerifications)
    .set({
      verificationStatus: params.status === "APPROVED" ? "APPROVED" : "REJECTED",
      reviewedByUserId: params.admin.id,
      reviewNotes: params.notes ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(evOwnerVerifications.operatorId, op.id));

  await writeAuditLog({
    actorUserId: params.admin.id,
    actorRole: params.admin.role,
    action: `OPERATOR_${params.status}`,
    entityType: "OPERATOR",
    entityId: op.id,
    beforeState: { status: op.status },
    afterState: { status: params.status },
  });

  return updated;
}

export async function updatePlatformPricingPolicy(params: {
  admin: SessionUser;
  platformFeeBps: number;
  defaultTaxBps: number;
  holdTtlSeconds: number;
}) {
  const { db } = await ensureDatabaseReady();
  const [prev] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "pricing_policy"))
    .limit(1);

  const nextVal = {
    platformFeeBps: params.platformFeeBps,
    defaultTaxBps: params.defaultTaxBps,
    holdTtlSeconds: params.holdTtlSeconds,
    freeCancellationWindowMinutes: 30,
  };

  if (prev) {
    await db
      .update(platformSettings)
      .set({ value: nextVal, updatedByUserId: params.admin.id, updatedAt: new Date() })
      .where(eq(platformSettings.key, "pricing_policy"));
  } else {
    await db.insert(platformSettings).values({
      key: "pricing_policy",
      value: nextVal,
      updatedByUserId: params.admin.id,
    });
  }

  await writeAuditLog({
    actorUserId: params.admin.id,
    actorRole: params.admin.role,
    action: "PLATFORM_POLICY_UPDATED",
    entityType: "PLATFORM_SETTING",
    entityId: "pricing_policy",
    beforeState: prev?.value ?? null,
    afterState: nextVal,
  });

  return nextVal;
}

export async function resolveSupportTicket(params: {
  admin: SessionUser;
  ticketId: string;
  status: "IN_REVIEW" | "RESOLVED" | "ESCALATED" | "CLOSED";
  resolutionNotes: string;
}) {
  const { db } = await ensureDatabaseReady();
  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, params.ticketId))
    .limit(1);

  if (!ticket) throw new AppError(404, "NOT_FOUND", "Support ticket not found");

  const [updated] = await db
    .update(supportTickets)
    .set({
      status: params.status,
      resolutionNotes: params.resolutionNotes,
      assignedAdminId: params.admin.id,
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, ticket.id))
    .returning();

  await db.insert(notifications).values({
    userId: ticket.userId,
    type: "SUPPORT_TICKET_UPDATED",
    title: `Support Ticket Updated: ${ticket.subject}`,
    body: `Status: ${params.status}. Note: ${params.resolutionNotes}`,
  });

  await writeAuditLog({
    actorUserId: params.admin.id,
    actorRole: params.admin.role,
    action: "SUPPORT_TICKET_RESOLVED",
    entityType: "SUPPORT_TICKET",
    entityId: ticket.id,
    beforeState: { status: ticket.status },
    afterState: { status: params.status, resolutionNotes: params.resolutionNotes },
  });

  return updated;
}
