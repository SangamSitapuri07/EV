import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { reviewFacilityApproval } from "@/features/admin/admin.service";

const reviewSchema = z.object({
  decision: z.enum(["ACTIVE", "SUSPENDED", "REJECTED"]),
  reason: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole(["SUPER_ADMIN"], req);
    const { id } = await context.params;
    const body = reviewSchema.parse(await req.json());
    const facility = await reviewFacilityApproval({
      admin,
      facilityId: id,
      decision: body.decision,
      reason: body.reason,
    });
    return ok({ facility });
  } catch (err) {
    return handleApiError(err);
  }
}
