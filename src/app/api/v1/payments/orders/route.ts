import { z } from "zod";
import { created, handleApiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import { createPaymentOrder } from "@/features/payments/payments.service";

const createOrderSchema = z.object({
  reservationId: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = createOrderSchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
    const result = await createPaymentOrder({
      user,
      reservationId: body.reservationId,
      idempotencyKey,
    });
    return created(result);
  } catch (err) {
    return handleApiError(err);
  }
}
