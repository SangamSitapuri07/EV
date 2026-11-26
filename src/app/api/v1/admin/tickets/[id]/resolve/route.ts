import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { resolveSupportTicket } from "@/features/admin/admin.service";

const schema = z.object({
  status: z.enum(["IN_REVIEW", "RESOLVED", "ESCALATED", "CLOSED"]),
  resolutionNotes: z.string().trim().min(3).max(1000),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole(["SUPER_ADMIN"], req);
    const { id } = await context.params;
    const body = schema.parse(await req.json());
    const ticket = await resolveSupportTicket({
      admin,
      ticketId: id,
      status: body.status,
      resolutionNotes: body.resolutionNotes,
    });
    return ok({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
