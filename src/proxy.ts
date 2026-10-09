import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Runs before every matched request: refreshes the Supabase auth cookie and
 * bounces signed-out visitors away from /admin and /dispatch.
 *
 * Named `proxy` because Next 16 renamed the `middleware` file convention to
 * `proxy`. Same behaviour, same config — only the file and export names moved.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // api/webhooks and api/cron are excluded on purpose: SumUp and the Vercel
    // cron authenticate with a signature or secret, not a session cookie, and the
    // session refresh here would only add latency and Set-Cookie noise to a
    // machine-to-machine call.
    "/((?!_next/static|_next/image|api/webhooks|api/cron|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
