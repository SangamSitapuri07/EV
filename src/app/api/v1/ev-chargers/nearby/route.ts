import { apiError, handleApiError, ok } from "@/lib/api-response";
import { nearbyChargersQuerySchema } from "@/features/search/search.service";
import { discoverNearbyExternalEvChargers } from "@/features/search/nearby-chargers.service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (v !== "") raw[k] = v;
    });

    const query = nearbyChargersQuerySchema.parse(raw);
    const result = await discoverNearbyExternalEvChargers({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radiusKm,
      connectorStandard: query.connectorStandard,
      minPowerKw: query.minPowerKw,
    });

    if (result.allEnabledProvidersFailed) {
      const summary = result.providerErrors
        .map((e) => `${e.provider}: ${e.message}`)
        .join("; ");
      return apiError(
        502,
        "PROVIDER_UNAVAILABLE",
        summary
          ? `All EV charger data providers failed (${summary})`
          : "All EV charger data providers are currently unavailable.",
        {
          sources: result.sources,
          providerErrors: result.providerErrors,
        }
      );
    }

    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
