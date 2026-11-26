import { handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import {
  extendReservation,
  extendReservationSchema,
} from "@/features/reservations/reservations.service";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;
    const body = extendReservationSchema.parse(await req.json());
    const result = await extendReservation(user, id, body.newEndTime);
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
