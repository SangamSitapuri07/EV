import { and, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { notifications, userProfiles } from "@/db/schema";
import { ok, handleApiError } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth";
import { isGoogleOAuthConfigured } from "@/features/auth/google-oauth.service";

export async function GET(req: Request) {
  try {
    const providers = {
      google: isGoogleOAuthConfigured(),
    };

    const user = await getSessionUser(req);
    if (!user) {
      return ok({ authenticated: false, user: null, providers });
    }

    const { db } = await ensureDatabaseReady();
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id))
      .limit(1);

    const unreadNotifications = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));

    return ok({
      authenticated: true,
      user,
      profile: profile ?? null,
      unreadNotificationsCount: unreadNotifications.length,
      providers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
