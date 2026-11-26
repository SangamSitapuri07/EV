import { handleApiError, ok } from "@/lib/api-response";
import { getCityHeatmapAndInsights } from "@/features/search/search.service";

export async function GET() {
  try {
    const data = await getCityHeatmapAndInsights();
    return ok(data);
  } catch (err) {
    return handleApiError(err);
  }
}
