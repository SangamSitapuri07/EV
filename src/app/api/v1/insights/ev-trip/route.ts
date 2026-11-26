import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { planEvTrip } from "@/features/search/search.service";

const tripSchema = z.object({
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  currentBatteryPct: z.number().min(1).max(100),
  vehicleRangeKm: z.number().min(30).max(1200),
  connectorStandard: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = tripSchema.parse(await req.json());
    const result = await planEvTrip(body);
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
