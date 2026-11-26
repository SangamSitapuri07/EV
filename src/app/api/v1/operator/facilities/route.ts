import { created, handleApiError } from "@/lib/api-response";
import { requireRole } from "@/lib/auth";
import {
  createFacilitySchema,
  createOperatorFacility,
} from "@/features/operator/operator.service";

export async function POST(req: Request) {
  try {
    const user = await requireRole(
      ["PARKING_OPERATOR", "EV_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const body = createFacilitySchema.parse(await req.json());
    const facility = await createOperatorFacility(user, body);
    return created({ facility });
  } catch (err) {
    return handleApiError(err);
  }
}
