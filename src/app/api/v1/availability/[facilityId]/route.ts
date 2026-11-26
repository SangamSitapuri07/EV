import { handleApiError, ok } from "@/lib/api-response";
import {
  getFacilityAvailability,
  simulateCityAvailabilityPulse,
} from "@/features/availability/availability.service";
import { requireRole } from "@/lib/auth";

export async function GET(
  req: Request,
  context: { params: Promise<{ facilityId: string }> }
) {
  try {
    const { facilityId } = await context.params;
    const url = new URL(req.url);
    const startTime = url.searchParams.get("startTime");
    const endTime = url.searchParams.get("endTime");

    const availability = await getFacilityAvailability({
      facilityId,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
    });

    return ok(availability);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireRole(["PARKING_OPERATOR", "EV_OPERATOR", "SUPER_ADMIN"], req);
    const result = await simulateCityAvailabilityPulse();
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
