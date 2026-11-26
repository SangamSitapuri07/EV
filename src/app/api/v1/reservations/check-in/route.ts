import { z } from "zod";
import { handleApiError, ok } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import { validateQrAndCheckIn } from "@/features/reservations/reservations.service";

const checkInSchema = z.object({
  qrToken: z.string().optional(),
  bookingReference: z.string().optional(),
  facilityId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const actor = await requireRole(
      ["PARKING_OPERATOR", "EV_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const body = checkInSchema.parse(await req.json());
    const result = await validateQrAndCheckIn({
      actor,
      qrToken: body.qrToken,
      bookingReference: body.bookingReference,
      facilityId: body.facilityId,
    });
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
}
