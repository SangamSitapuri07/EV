import { created, handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import {
  listUserChargingSessions,
  startChargingSchema,
  startChargingSession,
} from "@/features/charging/charging.service";

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const sessions = await listUserChargingSessions(user.id);
    return ok({
      sessions,
      simulationMode: true,
      disclosure: "EV charging telemetry uses InternalSimulatedChargeProvider in demo mode.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = startChargingSchema.parse(await req.json());
    const result = await startChargingSession(user, body);
    return created(result);
  } catch (err) {
    return handleApiError(err);
  }
}
