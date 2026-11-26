import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { reviewOperatorStatus } from "@/features/admin/admin.service";

const schema = z.object({
  status: z.enum(["APPROVED", "SUSPENDED", "REJECTED"]),
  notes: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole(["SUPER_ADMIN"], req);
    const { id } = await context.params;
    const body = schema.parse(await req.json());
    const operator = await reviewOperatorStatus({
      admin,
      operatorId: id,
      status: body.status,
      notes: body.notes,
    });
    return ok({ operator });
  } catch (err) {
    return handleApiError(err);
  }
}
