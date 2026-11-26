import { handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import { stopChargingSession } from "@/features/charging/charging.service";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;
    const session = await stopChargingSession({ user, sessionId: id });
    return ok({ session });
  } catch (err) {
    return handleApiError(err);
  }
}
