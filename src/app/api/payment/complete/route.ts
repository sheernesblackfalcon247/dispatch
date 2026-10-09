import { NextResponse } from "next/server";
import { getSumUp } from "@/lib/sumup";
import { redeemCheckout } from "@/lib/checkoutRedeem";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * Called by /booking/complete when the customer returns from SumUp.
 *
 * Verifies the checkout really was paid, then creates the booking. Safe to call
 * repeatedly — the draft row makes redemption happen exactly once, so a refresh
 * or a slow connection can't produce two bookings.
 */
export async function POST(req: Request) {
  if (!rateLimit(`complete:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const sumup = getSumUp();
  if (!sumup) return NextResponse.json({ ok: false, error: "payments_not_configured" });

  const { draft_id } = await req.json().catch(() => ({}));
  if (!draft_id || typeof draft_id !== "string" || !UUID.test(draft_id)) {
    return NextResponse.json({ ok: false, error: "missing_session" });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const result = await redeemCheckout(sumup, { draftId: draft_id }, origin);
  return NextResponse.json(result);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
