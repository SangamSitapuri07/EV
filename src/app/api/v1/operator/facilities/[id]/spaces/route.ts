import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { assertFacilityAccess } from "@/lib/permissions";
import { updateParkingSpaceStatus } from "@/features/availability/availability.service";

const updateSpaceSchema = z.object({
  spaceId: z.string().uuid(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "OUT_OF_SERVICE", "RESERVED"]),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(
      ["PARKING_OPERATOR", "EV_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const { id: facilityId } = await context.params;
    await assertFacilityAccess(user, facilityId);

    const body = updateSpaceSchema.parse(await req.json());
    const updated = await updateParkingSpaceStatus({
      facilityId,
      spaceId: body.spaceId,
      status: body.status,
      source: "OPERATOR",
    });

    return ok({ space: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
