import { notFound } from "next/navigation";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { facilities, facilityHours, pricingRules, reviews, users } from "@/db/schema";
import { getFacilityAvailability } from "@/features/availability/availability.service";
import { FacilityBookingClient } from "@/components/booking/facility-booking-client";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FacilityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { db } = await ensureDatabaseReady();

  const whereCond = UUID_REGEX.test(slug)
    ? or(eq(facilities.id, slug), eq(facilities.slug, slug))
    : eq(facilities.slug, slug);

  const [facility] = await db
    .select()
    .from(facilities)
    .where(and(whereCond, isNull(facilities.deletedAt)))
    .limit(1);

  if (!facility) {
    notFound();
  }

  const [availability, hours, rules, facilityReviews] = await Promise.all([
    getFacilityAvailability({ facilityId: facility.id }),
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

  return (
    <FacilityBookingClient
      initial={{
        facility,
        hours,
        pricingRules: rules,
        reviews: facilityReviews,
        availability,
      }}
    />
  );
}
