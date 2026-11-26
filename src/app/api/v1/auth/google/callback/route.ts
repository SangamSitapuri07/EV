import { NextResponse } from "next/server";
import {
  handleGoogleOAuthCallback,
  OAUTH_STATE_COOKIE_NAME,
  resolveRequestOrigin,
} from "@/features/auth/google-oauth.service";
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
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (oauthError) {
    const res = NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError === "access_denied" ? "oauth_cancelled" : "oauth_failed")}`,
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
    const res = NextResponse.redirect(`${origin}/login?error=oauth_state_invalid`, 302);
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
      secure: process.env.NODE_ENV === "production" || origin.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (err) {
    console.error("[google-oauth-callback] failed:", err);
    const res = NextResponse.redirect(`${origin}/login?error=oauth_failed`, 302);
    res.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return res;
  }
}
