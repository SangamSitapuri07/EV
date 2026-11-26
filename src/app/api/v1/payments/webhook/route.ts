import { handleApiError, ok } from "@/lib/api-response";
import { processGatewayWebhook } from "@/features/payments/payments.service";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-gateway-signature") ?? "";
    const gateway = req.headers.get("x-gateway-provider") ?? "RAZORPAY_SANDBOX";
    const result = await processGatewayWebhook({ rawBody, signature, gateway });
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
