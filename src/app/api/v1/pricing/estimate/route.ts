import { handleApiError, ok } from "@/lib/api-response";
import {
  calculatePriceEstimate,
  priceEstimateInputSchema,
} from "@/features/pricing/pricing.service";

export async function POST(req: Request) {
  try {
    const body = priceEstimateInputSchema.parse(await req.json());
    const estimate = await calculatePriceEstimate(body);
    return ok(estimate);
  } catch (err) {
    return handleApiError(err);
  }
}
