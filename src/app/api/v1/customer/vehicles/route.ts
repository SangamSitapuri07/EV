import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { vehicles } from "@/db/schema";
import { AppError, created, ok, handleApiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";

const vehicleSchema = z.object({
  nickname: z.string().trim().min(2).max(100),
  registrationNumber: z.string().trim().min(4).max(32).toUpperCase(),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  vehicleCategory: z
    .enum(["STANDARD", "COMPACT", "SUV", "TWO_WHEELER", "ACCESSIBLE", "EV_COMPATIBLE", "VIP_RESERVED"])
    .default("STANDARD"),
  isElectric: z.boolean().default(false),
  batteryCapacityKwh: z.number().min(1).max(250).optional().nullable(),
  supportedConnector: z
    .enum(["CCS2", "TYPE2_AC", "CHADEMO", "BHARAT_DC001", "BHARAT_AC001", "GB_T"])
    .optional()
    .nullable(),
  maxDcKw: z.number().min(1).max(400).optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = vehicleSchema.parse(await req.json());
    const { db } = await ensureDatabaseReady();

    const [vehicle] = await db
      .insert(vehicles)
      .values({
        userId: user.id,
        nickname: body.nickname,
        registrationNumber: body.registrationNumber,
        make: body.make,
        model: body.model,
        vehicleCategory: body.vehicleCategory,
        isElectric: body.isElectric,
        batteryCapacityKwh: body.batteryCapacityKwh ?? null,
        supportedConnector: body.supportedConnector ?? null,
        maxDcKw: body.maxDcKw ?? null,
      })
      .returning();

    return created({ vehicle });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireAuth(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new AppError(400, "MISSING_ID", "Vehicle id is required");

    const { db } = await ensureDatabaseReady();
    const deleted = await db
      .delete(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.userId, user.id)))
      .returning();

    if (deleted.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Vehicle not found");
    }
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
