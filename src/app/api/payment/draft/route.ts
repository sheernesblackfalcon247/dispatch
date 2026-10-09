import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { ownsDraft } from "@/lib/draftCookie";

/**
 * Give a cancelled checkout its form contents back.
 *
 * When someone backs out of SumUp they return to /book (by the back button,
 * or a /book?resume=<draft id> link), and
 * this hands the widget the trip they already typed so they don't have to enter
 * addresses, name and phone a second time.
 *
 * The draft id is an unguessable uuid the customer was just redirected with —
 * the same trust model as a booking reference. Only an unredeemed, unexpired
 * draft is returned, so it can't be used to browse past customers' details.
 */
export async function GET(req: Request) {
  if (!rateLimit(`draft:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" });

  // The id is not a password. Only the browser that started this checkout may
  // read the trip back — see src/lib/draftCookie.ts.
  if (!ownsDraft(req, id)) return NextResponse.json({ ok: false, error: "not_found" });

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("checkout_drafts")
      .select("payload, amount, status, booking_number, expires_at")
      .eq("id", id)
      .maybeSingle();

    if (!data) return NextResponse.json({ ok: false, error: "not_found" });
    // Already paid for — send them to the booking instead of refilling a form.
    if (data.booking_number) {
      return NextResponse.json({ ok: false, error: "already_booked", booking_number: data.booking_number });
    }
    if (new Date(data.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: "expired" });
    }

    return NextResponse.json({ ok: true, payload: data.payload, amount: Number(data.amount) || 0 });
  } catch (err) {
    console.error("[draft] lookup failed", err);
    return NextResponse.json({ ok: false, error: "lookup_failed" });
  }
}
