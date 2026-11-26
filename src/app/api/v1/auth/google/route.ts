import { NextResponse } from "next/server";
import {
  createGoogleAuthorizationRequest,
  isGoogleOAuthConfigured,
  OAUTH_STATE_COOKIE_NAME,
  resolveRequestOrigin,
} from "@/features/auth/google-oauth.service";
import { handleApiError } from "@/lib/api-response";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const origin = resolveRequestOrigin(req);

    if (!isGoogleOAuthConfigured()) {
      const accept = req.headers.get("accept") ?? "";
      if (accept.includes("application/json") && !accept.includes("text/html")) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "GOOGLE_OAUTH_NOT_CONFIGURED",
              message:
                "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env to enable Google Sign-In.",
            },
          },
          { status: 503 }
        );
      }
      return NextResponse.redirect(`${origin}/login?error=google_not_configured`, 302);
    }

    const redirectTo = url.searchParams.get("redirectTo");
    const { authorizationUrl, stateCookieJwt } = await createGoogleAuthorizationRequest({
      req,
      redirectTo,
    });

    const response = NextResponse.redirect(authorizationUrl, 302);
    response.cookies.set(OAUTH_STATE_COOKIE_NAME, stateCookieJwt, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production" || origin.startsWith("https://"),
      maxAge: 60 * 10,
    });

    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
