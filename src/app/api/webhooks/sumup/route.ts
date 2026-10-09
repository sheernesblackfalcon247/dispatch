import { NextResponse } from "next/server";
import { getSumUp } from "@/lib/sumup";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepUnmatchedPayments } from "@/lib/paymentAlerts";
import { redeemCheckout } from "@/lib/checkoutRedeem";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * SumUp checkout notifications.
 *
 * Every checkout we create names this URL as its `return_url`, so there is
 * nothing to set up in the SumUp Dashboard. SumUp POSTs here when a checkout's
 * status changes, with a body like
 *
 *   { "event_type": "CHECKOUT_STATUS_CHANGED", "id": "<checkout id>" }
 *
 * These notifications are NOT signed, so the body is only ever treated as a
 * hint: we take the checkout id and ask SumUp's API what actually happened.
 * A forged call can at most make us look up a checkout — it can never make a
 * booking for money that wasn't paid.
 *
 * This is the safety net for the customer who paid and then closed the tab,
 * lost signal, or never came back: the booking gets created here instead, with
 * the same emails and SMS they would have got.
 */
export async function POST(req: Request) {
  if (!rateLimit(`sumup-webhook:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const sumup = getSumUp();
  if (!sumup) {
    // Not 200 — SumUp should try again once we are configured.
    console.error("[sumup-webhook] SUMUP_API_KEY / SUMUP_MERCHANT_CODE not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { event_type?: string; id?: string } | null;
  const checkoutId = typeof body?.id === "string" ? body.id.trim() : "";
  // Anything we don't understand is acknowledged and ignored.
  if (!checkoutId || (body?.event_type && body.event_type !== "CHECKOUT_STATUS_CHANGED")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const admin = createAdminClient();

  // Only checkouts this app started have a draft. Another business on the same
  // SumUp account is not our money and not our row.
  const { data: draft } = await admin
    .from("checkout_drafts")
    .select("id")
    .eq("session_id", checkoutId)
    .maybeSingle();
  if (!draft) return NextResponse.json({ ok: true, ignored: true });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

  let status: string | undefined;
  try {
    status = (await sumup.getCheckout(checkoutId)).status;
  } catch (err) {
    console.error("[sumup-webhook] could not read checkout", checkoutId, err);
    return NextResponse.json({ ok: false, error: "provider_unreachable" }, { status: 500 });
  }

  if (status === "PAID") {
    const result = await redeemCheckout(sumup, { checkoutId }, origin);
    if (!result.ok) {
      // 500 so SumUp tries again; the orphan-payment machinery has already
      // put it in front of staff if the money is in but the booking won't save.
      console.error("[sumup-webhook] redemption failed", checkoutId, result.error);
      return NextResponse.json({ ok: false, error: "handler_failed" }, { status: 500 });
    }
  } else if (status === "EXPIRED") {
    // Customer never paid within the window. Tidy the draft away.
    await admin
      .from("checkout_drafts")
      .update({ status: "expired" })
      .eq("session_id", checkoutId)
      .eq("status", "open")
      .is("booking_id", null);
  }
  // FAILED: the customer can retry on the same hosted page — nothing to do.

  // Opportunistic catch-up: every notification doubles as a chance to chase
  // payments nobody has been told about.
  await sweepUnmatchedPayments(origin);

  return NextResponse.json({ ok: true });
}
