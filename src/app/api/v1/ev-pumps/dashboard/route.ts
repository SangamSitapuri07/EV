import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { getEvPumpsDashboardData } from "@/features/operator/operator.service";

export async function GET(req: Request) {
  try {
    const user = await requireRole(
      ["EV_OPERATOR", "PARKING_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const data = await getEvPumpsDashboardData(user);
    return ok(data);
  } catch (err) {
    return handleApiError(err);
  }
}
