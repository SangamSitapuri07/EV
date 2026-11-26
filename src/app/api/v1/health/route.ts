import { ensureDatabaseReady } from "@/db";
import { ok, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    const state = await ensureDatabaseReady();
    const rows = await state.rawQuery<{ now: string }>("SELECT NOW()::text AS now");
    return ok({
      status: "healthy",
      service: "smart-parking-ev-finder",
      version: "1.0.0",
      database: {
        mode: state.mode,
        postgisEnabled: state.hasPostgis,
        serverTime: rows[0]?.now ?? new Date().toISOString(),
      },
      paymentGatewayMode: process.env.PAYMENT_GATEWAY_MODE || "sandbox",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
