import { handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import { listUserPaymentsAndRefunds } from "@/features/payments/payments.service";

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const history = await listUserPaymentsAndRefunds(user.id);
    return ok(history);
  } catch (err) {
    return handleApiError(err);
  }
}
