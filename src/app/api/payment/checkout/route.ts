import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSumUp, round2 } from "@/lib/sumup";
import { getWebsiteKey } from "@/lib/getWebsiteKey";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceTrip } from "@/lib/pricing";
import { quoteSignature } from "@/lib/quoteSignature";
import { validateBookingInput, type BookingInput } from "@/lib/bookingFlow";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { cardPaymentsEnabled } from "@/lib/paymentMethods";
import { draftCookieValue } from "@/lib/draftCookie";

/**
 * Start a SumUp Hosted Checkout payment.
 *
 * The booking is deliberately NOT created here. The trip is priced server-side,
 * parked in `checkout_drafts`, and the customer is sent to SumUp's own hosted
 * page. Only once SumUp confirms the money does the draft become a booking —
 * so an abandoned checkout leaves nothing on the dispatch board.
 */
export async function POST(req: Request) {
  // Each call prices the trip (Google Directions) and opens a live SumUp
  // checkout — cap per IP so it can't be scripted to run up bills.
  if (!rateLimit(`checkout:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // A hidden button is not a rule — refuse here too, or a crafted request could
  // still start a checkout the site is deliberately not offering.
  if (!cardPaymentsEnabled()) {
    return NextResponse.json({ ok: false, error: "card_disabled" });
  }

  const sumup = getSumUp();
  if (!sumup) return NextResponse.json({ ok: false, error: "payments_not_configured" });

  const b = (await req.json().catch(() => ({}))) as Partial<BookingInput>;

  // Validate the FULL booking now, not after payment: taking money for a trip
  // we would then refuse to save is the one outcome worth engineering against.
  const invalid = validateBookingInput(b);
  if (invalid) return NextResponse.json({ ok: false, error: invalid });

  const site = b.site ?? "main";
  const apiKey = await getWebsiteKey(site);
  if (!apiKey) return NextResponse.json({ ok: false, error: "invalid_website" });

  const input = b as BookingInput;
  const priced = await priceTrip(apiKey, {
    category_id: input.category_id,
    child_seat: input.child_seat,
    outbound: input.outbound,
    return: input.return ?? null,
  });
  if (priced == null) return NextResponse.json({ ok: false, error: "quote_failed" });

  const total = round2(priced);
  if (total < 0.3) return NextResponse.json({ ok: false, error: "amount_too_low" });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  // Generated up front: it is the SumUp checkout_reference and rides on the
  // redirect URL, so the return page knows which trip this payment was for.
  const draftId = randomUUID();
  const sig = quoteSignature({
    site,
    category_id: input.category_id,
    child_seat: !!input.child_seat,
    outbound: input.outbound,
    return: input.return ?? null,
  });

  const journey = `${input.outbound.pickup_address} → ${input.outbound.dropoff_address}`;
  const when = input.outbound.scheduled_at
    ? new Date(input.outbound.scheduled_at).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "As soon as possible";

  const admin = createAdminClient();

  // Pressing "Pay" again for the same trip — after backing out of SumUp, or on
  // a second tab — must land on the SAME checkout, not open a new one.
  const { data: reusable } = await admin
    .from("checkout_drafts")
    .select("id, session_id")
    .eq("quote_sig", sig)
    .eq("customer_email", input.email)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable) {
    try {
      const existing = await sumup.getCheckout(reusable.session_id);
      if (existing.status === "PENDING" && existing.hosted_checkout_url) {
        const res = NextResponse.json({
          ok: true,
          url: existing.hosted_checkout_url,
          draft_id: reusable.id,
          amount: total,
        });
        res.headers.set("Set-Cookie", draftCookieValue(req, reusable.id));
        return res;
      }
    } catch {
      /* gone or expired at SumUp's end — fall through and open a fresh one */
    }
  }

  let checkout;
  try {
    checkout = await sumup.createCheckout({
      // Unique per attempt — SumUp refuses a second checkout with the same one,
      // which also makes our own retry of this call safe.
      checkout_reference: draftId,
      amount: total,
      currency: "GBP",
      description: `${input.return ? "Taxi booking (return)" : "Taxi booking"} · ${journey} · ${when}`.slice(0, 255),
      // Where the customer lands after paying.
      redirect_url: `${origin}/booking/complete?draft=${draftId}`,
      // Server-to-server status notification — the safety net for a customer
      // who pays and never makes it back to the site.
      return_url: `${origin}/api/webhooks/sumup`,
      // The draft expires alongside it.
      valid_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  } catch (err) {
    console.error("[checkout] SumUp checkout create failed", err);
    return NextResponse.json({ ok: false, error: "payment_provider_error" });
  }

  if (!checkout?.id || !checkout.hosted_checkout_url) {
    console.error("[checkout] SumUp returned no hosted checkout URL", checkout);
    return NextResponse.json({ ok: false, error: "payment_provider_error" });
  }

  // Park the trip. If this fails the customer could pay for something we can
  // never turn into a booking — so deactivate the checkout rather than risk it.
  const { error } = await admin.from("checkout_drafts").insert({
    id: draftId,
    session_id: checkout.id,
    payload: input,
    amount: total,
    currency: "gbp",
    website_slug: site,
    customer_email: input.email,
    quote_sig: sig,
    status: "open",
  });

  if (error) {
    console.error("[checkout] could not save draft — deactivating checkout", error);
    try {
      await sumup.deactivateCheckout(checkout.id);
    } catch {
      /* best effort; the checkout expires on its own in 30 minutes anyway */
    }
    return NextResponse.json({ ok: false, error: "draft_failed" });
  }

  const res = NextResponse.json({ ok: true, url: checkout.hosted_checkout_url, draft_id: draftId, amount: total });
  // Marks this browser as the owner, so only it can read the trip back.
  res.headers.set("Set-Cookie", draftCookieValue(req, draftId));
  return res;
}
