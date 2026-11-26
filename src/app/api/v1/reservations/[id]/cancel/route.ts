import { handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import {
  cancelReservation,
  cancelReservationSchema,
} from "@/features/reservations/reservations.service";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;
    const body = cancelReservationSchema.parse(await req.json().catch(() => ({})));
    const result = await cancelReservation(user, id, body.reason);
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
