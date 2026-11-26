import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { checkOutParkingSession } from "@/features/reservations/reservations.service";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireRole(
      ["PARKING_OPERATOR", "EV_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const { id } = await context.params;
    const result = await checkOutParkingSession({ actor, reservationId: id });
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
