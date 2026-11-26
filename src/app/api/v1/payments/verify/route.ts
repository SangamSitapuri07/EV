import crypto from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { paymentOrders } from "@/db/schema";
import { AppError, handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import {
  computePaymentSignature,
  verifyAndCapturePayment,
} from "@/features/payments/payments.service";

const verifySchema = z.object({
  paymentOrderId: z.string().uuid(),
  gatewayPaymentId: z.string().min(4).optional(),
  gatewaySignature: z.string().min(8).optional(),
  method: z.string().optional(),
  simulateSandboxSuccess: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = verifySchema.parse(await req.json());

    let gatewayPaymentId = body.gatewayPaymentId;
    let gatewaySignature = body.gatewaySignature;

    // In sandbox test mode ONLY, allow client to trigger a simulated gateway completion
    // which computes the HMAC signature on the server without ever leaking the secret key.
    if (body.simulateSandboxSuccess) {
      if ((process.env.PAYMENT_GATEWAY_MODE || "sandbox") !== "sandbox") {
        throw new AppError(403, "SANDBOX_DISABLED", "Sandbox simulation disabled in live mode");
      }
      const { db } = await ensureDatabaseReady();
      const [order] = await db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.id, body.paymentOrderId))
        .limit(1);
      if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Payment order not found");

      gatewayPaymentId = `pay_sbx_${crypto.randomBytes(6).toString("hex")}`;
      gatewaySignature = computePaymentSignature(order.gatewayOrderId, gatewayPaymentId);
    }

    if (!gatewayPaymentId || !gatewaySignature) {
      throw new AppError(400, "MISSING_PAYMENT_PROOF", "gatewayPaymentId and gatewaySignature required");
    }

    const result = await verifyAndCapturePayment({
      user,
      paymentOrderId: body.paymentOrderId,
      gatewayPaymentId,
      gatewaySignature,
      method: body.method,
    });

    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
