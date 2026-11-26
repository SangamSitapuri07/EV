import { z } from "zod";
import { created, handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { assertFacilityAccess } from "@/lib/permissions";
import { updateConnectorStatus } from "@/features/availability/availability.service";
import { addOperatorConnector } from "@/features/operator/operator.service";

const createConnectorSchema = z.object({
  standard: z.enum(["CCS2", "TYPE2_AC", "CHADEMO", "BHARAT_DC001", "BHARAT_AC001", "GB_T"]),
  maxPowerKw: z.number().min(3).max(400),
  pricePerKwhPaise: z.number().int().min(100).max(50000),
});

const patchConnectorSchema = z.object({
  connectorId: z.string().uuid(),
  status: z.enum(["AVAILABLE", "CHARGING", "FAULTED", "OFFLINE", "RESERVED"]),
  faultReason: z.string().max(300).optional().nullable(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(["EV_OPERATOR", "PARKING_OPERATOR", "SUPER_ADMIN"], req);
    const { id: facilityId } = await context.params;
    const body = createConnectorSchema.parse(await req.json());
    const connector = await addOperatorConnector(user, facilityId, body);
    return created({ connector });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(["EV_OPERATOR", "PARKING_OPERATOR", "SUPER_ADMIN"], req);
    const { id: facilityId } = await context.params;
    await assertFacilityAccess(user, facilityId);

    const body = patchConnectorSchema.parse(await req.json());
    const connector = await updateConnectorStatus({
      facilityId,
      connectorId: body.connectorId,
      status: body.status,
      faultReason: body.faultReason,
      source: "OPERATOR",
    });

    return ok({ connector });
  } catch (err) {
    return handleApiError(err);
  }
}
