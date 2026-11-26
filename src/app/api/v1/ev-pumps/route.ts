import { handleApiError, ok } from "@/lib/api-response";
import { listEvPumpsWithAvailability } from "@/features/charging/charging.service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const startTime = url.searchParams.get("startTime") ?? undefined;
    const endTime = url.searchParams.get("endTime") ?? undefined;
    const standard = url.searchParams.get("standard") ?? undefined;
    const minKwRaw = url.searchParams.get("minKw");
    const minKw = minKwRaw ? Number(minKwRaw) : undefined;
    const q = url.searchParams.get("q") ?? undefined;

    const data = await listEvPumpsWithAvailability({
      startTime,
      endTime,
      standard,
      minKw: Number.isFinite(minKw) ? minKw : undefined,
      q,
    });

    return ok(data);
  } catch (err) {
    return handleApiError(err);
  }
}
