import { handleApiError, ok } from "@/lib/api-response";
import {
  facilitySearchQuerySchema,
  searchFacilities,
} from "@/features/search/search.service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (v !== "") raw[k] = v;
    });

    const query = facilitySearchQuerySchema.parse(raw);
    const result = await searchFacilities(query);
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
