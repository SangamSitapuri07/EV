import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { updatePlatformPricingPolicy } from "@/features/admin/admin.service";

const settingsSchema = z.object({
  platformFeeBps: z.number().int().min(0).max(3000),
  defaultTaxBps: z.number().int().min(0).max(3000),
  holdTtlSeconds: z.number().int().min(60).max(3600),
});

export async function PATCH(req: Request) {
  try {
    const admin = await requireRole(["SUPER_ADMIN"], req);
    const body = settingsSchema.parse(await req.json());
    const updated = await updatePlatformPricingPolicy({ admin, ...body });
    return ok({ policy: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
