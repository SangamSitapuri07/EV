import { ok } from "@/lib/api-response";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const res = ok({ loggedOut: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
