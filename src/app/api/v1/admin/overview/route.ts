import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { getAdminOverview } from "@/features/admin/admin.service";

export async function GET(req: Request) {
  try {
    await requireRole(["SUPER_ADMIN"], req);
    const overview = await getAdminOverview();
    return ok(overview);
  } catch (err) {
    return handleApiError(err);
  }
}
