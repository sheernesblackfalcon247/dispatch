import { NextResponse } from "next/server";
import { getWebsiteKey } from "@/lib/getWebsiteKey";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { splitFare } from "@/lib/fare";
import {
  validateBookingInput,
  createTrip,
  notifyBooking,
  type BookingInput,
} from "@/lib/bookingFlow";

/**
 * Create a booking that is NOT paid by card up front — cash rides, and staff
 * bookings taken over the phone.
 *
 * Card bookings do not come through here any more. They go to SumUp Checkout
 * (/api/payment/checkout) and the booking is written on the way back, once
 * SumUp confirms the money — see src/lib/checkoutRedeem.ts.
 */
export async function POST(req: Request) {
  // Throttle: booking sends an SMS + emails to client-supplied addresses and hits
  // Google — cap per IP so it can't be scripted to bomb numbers or run up bills.
  if (!rateLimit(`book:${clientIp(req)}`, 15, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const b = (await req.json().catch(() => ({}))) as Partial<BookingInput> & { custom_fare?: unknown };

  const invalid = validateBookingInput(b);
  if (invalid) return NextResponse.json({ ok: false, error: invalid });

  const input = b as BookingInput;

  // Resolved once: it decides both who may book a card ride and whose
  // hand-typed distance we are willing to believe.
  const me = await getSessionProfile();
  const isStaff = !!me && (me.role === "admin" || me.role === "dispatcher");

  // A card ride must be paid before it exists. Refusing here stops a crafted
  // request from booking a card trip for free.
  if (input.payment_method === "card" && !isStaff) {
    return NextResponse.json({ ok: false, error: "use_checkout" });
  }

  const key = await getWebsiteKey(input.site ?? "main");
  if (!key) return NextResponse.json({ ok: false, error: "invalid_website" });

  // Only staff may book without coordinates (a phone booking with a typed
  // address). For the public, no coordinates means no price — see
  // resolveLegDistance().
  const created = await createTrip(input, key, { trustClient: isStaff });
  if ("error" in created) {
    return NextResponse.json(created.error);
  }

  // Staff-only manual price override (discount / rush pricing). Verified against
  // the logged-in staff session, so a public customer can NEVER set their own price.
  let overrideFare: number | null = null;
  const requestedFare = Number(b.custom_fare);
  const outboundId = created.outbound.booking_id;
  if (b.custom_fare != null && Number.isFinite(requestedFare) && requestedFare >= 0 && outboundId) {
    if (isStaff) {
      overrideFare = requestedFare;
      const admin = createAdminClient();
      const returnId = created.return?.ok ? created.return.booking_id : null;
      if (returnId) {
        // The custom price is the WHOLE-TRIP total. Split it across both legs so the
        // per-leg fares still sum to it (cash collection, settlement, analytics all
        // read per-leg estimated_fare). Split in proportion to the original leg fares.
        const { out: outShare, ret: retShare } = splitFare(
          overrideFare,
          created.outbound.estimated_fare ?? 0,
          created.return?.estimated_fare ?? 0
        );
        await admin
          .from("bookings")
          .update({
            estimated_fare: outShare,
            fare_breakdown: {
              total: outShare,
              custom: true,
              custom_trip_total: overrideFare,
              note: "Custom price set by staff (outbound share)",
            },
          })
          .eq("id", outboundId);
        await admin
          .from("bookings")
          .update({
            estimated_fare: retShare,
            fare_breakdown: {
              total: retShare,
              custom: true,
              custom_trip_total: overrideFare,
              note: "Custom price set by staff (return share)",
            },
          })
          .eq("id", returnId);
      } else {
        await admin
          .from("bookings")
          .update({
            estimated_fare: overrideFare,
            fare_breakdown: { total: overrideFare, custom: true, note: "Custom price set by staff" },
          })
          .eq("id", outboundId);
      }
    }
  }

  const totalFare = overrideFare ?? created.total;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

  await notifyBooking({ input, trip: created, totalFare, paid: false, origin });

  return NextResponse.json({
    ok: true,
    outbound: created.outbound,
    return: created.return,
    paid: false,
    fare: totalFare,
  });
}
