import { handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import { getReservationDetails } from "@/features/reservations/reservations.service";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;
    const details = await getReservationDetails(user, id);
    return ok(details);
  } catch (err) {
    return handleApiError(err);
  }
}
