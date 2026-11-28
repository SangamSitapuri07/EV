import { NextResponse } from "next/server";
import {
  getGoogleRedirectUri,
  handleGoogleOAuthCallback,
  OAUTH_STATE_COOKIE_NAME,
  resolveRequestOrigin,
} from "@/features/auth/google-oauth.service";
import { AppError } from "@/lib/api-response";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

function readCookieFromHeader(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = resolveRequestOrigin(req);
  const oauthError = url.searchParams.get("error");
  const oauthErrorDesc = url.searchParams.get("error_description");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (oauthError) {
    const codeKey = oauthError === "access_denied" ? "oauth_cancelled" : "oauth_failed";
    const detailParam =
      oauthErrorDesc || oauthError !== "access_denied"
        ? `&detail=${encodeURIComponent(
            [oauthError, oauthErrorDesc].filter(Boolean).join(": ").slice(0, 240)
          )}`
        : "";
    const res = NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(codeKey)}${detailParam}`,
      302
    );
    res.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return res;
  }

  const stateCookieToken = readCookieFromHeader(
    req.headers.get("cookie") ?? "",
    OAUTH_STATE_COOKIE_NAME
  );

  if (!code || !state || !stateCookieToken) {
    const missingReason = !stateCookieToken
      ? `Missing OAuth state cookie on ${origin}. Ensure you start and finish login on the exact same host (and register ${getGoogleRedirectUri(req)} in Google Cloud Console).`
      : "Missing authorization code or state from Google.";
    const res = NextResponse.redirect(
      `${origin}/login?error=oauth_state_invalid&detail=${encodeURIComponent(missingReason.slice(0, 240))}`,
      302
    );
    res.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return res;
  }

  try {
    const { sessionToken, redirectTo } = await handleGoogleOAuthCallback({
      req,
      code,
      state,
      stateCookieToken,
    });

    const response = NextResponse.redirect(`${origin}${redirectTo}`, 302);
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: origin.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (err) {
    console.error("[google-oauth-callback] failed:", err);
    const detail =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown OAuth callback error";
    const res = NextResponse.redirect(
      `${origin}/login?error=oauth_failed&detail=${encodeURIComponent(detail.slice(0, 240))}`,
      302
    );
    res.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return res;
  }
}
