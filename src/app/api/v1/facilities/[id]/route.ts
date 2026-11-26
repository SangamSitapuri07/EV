import { and, desc, eq, isNull, or } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { facilities, facilityHours, pricingRules, reviews, users } from "@/db/schema";
import { AppError, handleApiError, ok } from "@/lib/api-response";
import { getFacilityAvailability } from "@/features/availability/availability.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { db } = await ensureDatabaseReady();

    const whereCond = UUID_REGEX.test(id)
      ? or(eq(facilities.id, id), eq(facilities.slug, id))
      : eq(facilities.slug, id);

    const [facility] = await db
      .select()
      .from(facilities)
      .where(and(whereCond, isNull(facilities.deletedAt)))
      .limit(1);

    if (!facility) {
      throw new AppError(404, "NOT_FOUND", "Facility not found");
    }

    const url = new URL(req.url);
    const startParam = url.searchParams.get("startTime");
    const endParam = url.searchParams.get("endTime");

    const [availability, hours, rules, facilityReviews] = await Promise.all([
      getFacilityAvailability({
        facilityId: facility.id,
        startTime: startParam ? new Date(startParam) : undefined,
        endTime: endParam ? new Date(endParam) : undefined,
      }),
      db.select().from(facilityHours).where(eq(facilityHours.facilityId, facility.id)),
      db
        .select()
        .from(pricingRules)
        .where(and(eq(pricingRules.facilityId, facility.id), eq(pricingRules.isActive, true)))
        .orderBy(desc(pricingRules.priority)),
      db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
          authorName: users.fullName,
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.userId, users.id))
        .where(eq(reviews.facilityId, facility.id))
        .orderBy(desc(reviews.createdAt)),
    ]);

    return ok({
      facility,
      hours,
      pricingRules: rules,
      reviews: facilityReviews,
      availability,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
