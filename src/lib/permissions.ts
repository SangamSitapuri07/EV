import { and, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { facilities, operators, operatorStaff } from "@/db/schema";
import { AppError } from "./api-response";
import type { SessionUser } from "./auth";

export async function getUserOperatorIds(userId: string): Promise<string[]> {
  const { db } = await ensureDatabaseReady();

  const owned = await db
    .select({ id: operators.id })
    .from(operators)
    .where(eq(operators.ownerUserId, userId));

  const staffed = await db
    .select({ operatorId: operatorStaff.operatorId })
    .from(operatorStaff)
    .where(and(eq(operatorStaff.userId, userId), eq(operatorStaff.isActive, true)));

  return Array.from(
    new Set([...owned.map((o) => o.id), ...staffed.map((s) => s.operatorId)])
  );
}

export async function assertOperatorAccess(
  user: SessionUser,
  operatorId: string
): Promise<void> {
  if (user.role === "SUPER_ADMIN") return;
  if (user.role !== "PARKING_OPERATOR" && user.role !== "EV_OPERATOR") {
    throw new AppError(403, "FORBIDDEN", "Operator role required");
  }
  const ids = await getUserOperatorIds(user.id);
  if (!ids.includes(operatorId)) {
    throw new AppError(403, "FORBIDDEN", "You do not have access to this operator account");
  }
}

export async function assertFacilityAccess(
  user: SessionUser,
  facilityId: string
): Promise<{ facility: typeof facilities.$inferSelect }> {
  const { db } = await ensureDatabaseReady();
  const [facility] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, facilityId))
    .limit(1);

  if (!facility || facility.deletedAt) {
    throw new AppError(404, "NOT_FOUND", "Facility not found");
  }

  if (user.role === "SUPER_ADMIN") {
    return { facility };
  }

  if (user.role !== "PARKING_OPERATOR" && user.role !== "EV_OPERATOR") {
    throw new AppError(403, "FORBIDDEN", "Operator permission required");
  }

  const operatorIds = await getUserOperatorIds(user.id);
  if (!operatorIds.includes(facility.operatorId)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Cross-operator access denied: you do not own or staff this facility"
    );
  }

  return { facility };
}

export async function assertReservationReadAccess(
  user: SessionUser,
  reservation: { userId: string; facilityId: string }
): Promise<void> {
  if (user.role === "SUPER_ADMIN") return;
  if (reservation.userId === user.id) return;

  if (user.role === "PARKING_OPERATOR" || user.role === "EV_OPERATOR") {
    await assertFacilityAccess(user, reservation.facilityId);
    return;
  }

  throw new AppError(403, "FORBIDDEN", "You cannot access another user's reservation");
}
