import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { getOperatorDashboardData } from "@/features/operator/operator.service";

export async function GET(req: Request) {
  try {
    const user = await requireRole(
      ["PARKING_OPERATOR", "EV_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const data = await getOperatorDashboardData(user);
    return ok(data);
  } catch (err) {
    return handleApiError(err);
  }
}
