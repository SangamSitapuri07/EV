import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import { advanceSimulatedChargingSession } from "@/features/charging/charging.service";

const tickSchema = z.object({
  kwhIncrement: z.number().min(0).max(50).optional(),
  idleMinutesIncrement: z.number().int().min(0).max(120).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req);
    const { id } = await context.params;
    const body = tickSchema.parse(await req.json().catch(() => ({})));
    const result = await advanceSimulatedChargingSession({
      user,
      sessionId: id,
      kwhIncrement: body.kwhIncrement,
      idleMinutesIncrement: body.idleMinutesIncrement,
    });
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
