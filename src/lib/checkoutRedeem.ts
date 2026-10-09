import { createAdminClient } from "@/lib/supabase/admin";
import { getWebsiteKey } from "@/lib/getWebsiteKey";
import { paidTransaction, round2, type SumUp, type SumUpCheckout } from "@/lib/sumup";
import { splitFare } from "@/lib/fare";
import { createTrip, notifyBooking, validateBookingInput, type BookingInput } from "@/lib/bookingFlow";

/**
 * Turn a paid SumUp checkout into a booking — exactly once.
 *
 * Two things race to call this: the customer landing back on /booking/complete,
 * and the SumUp webhook. Whichever arrives first does the work; the other reads
 * the result. The draft row is the lock, so a customer on
 * a slow phone can never end up with two bookings for one payment.
 */

export interface RedeemResult {
  ok: boolean;
  /** Still being created by the other caller — the page should poll. */
  pending?: boolean;
  error?: string;
  bookingNumber?: string;
  returnBookingNumber?: string | null;
  fare?: number;
  paid?: boolean;
  receiptUrl?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

interface DraftRow {
  id: string;
  session_id: string;
  payload: BookingInput;
  amount: number;
  website_slug: string | null;
  status: string;
  booking_id: string | null;
  booking_number: string | null;
}

/**
 * Look the draft up by our own id (the return page) or by SumUp's checkout id
 * (the webhook), then redeem it.
 */
export async function redeemCheckout(
  sumup: SumUp,
  ref: { draftId: string } | { checkoutId: string },
  origin: string
): Promise<RedeemResult> {
  const admin = createAdminClient();

  const query = admin
    .from("checkout_drafts")
    .select("id, session_id, payload, amount, website_slug, status, booking_id, booking_number");
  const { data: draft } = await ("draftId" in ref
    ? query.eq("id", ref.draftId)
    : query.eq("session_id", ref.checkoutId)
  ).maybeSingle();

  if (!draft) return { ok: false, error: "unknown_session" };
  const d = draft as DraftRow;

  // Already done — this is the second caller, or the customer refreshing.
  if (d.booking_id && d.booking_number) {
    return await describeExisting(admin, d);
  }

  // Has the money actually arrived? SumUp is the only authority on that.
  let checkout: SumUpCheckout;
  try {
    checkout = await sumup.getCheckout(d.session_id);
  } catch (err) {
    console.error("[checkout] could not retrieve SumUp checkout", d.session_id, err);
    return { ok: false, error: "provider_unreachable" };
  }

  // Card processing (3-D Secure especially) can still be settling when the
  // customer is redirected back. Let the return page keep asking.
  if (checkout.status === "PENDING") return { ok: true, pending: true };
  if (checkout.status !== "PAID") return { ok: false, error: "not_paid" };

  const txn = paidTransaction(checkout);
  const receiptUrl: string | null = null; // SumUp emails its own receipt to the payer
  const amountPaid = round2(Number(txn?.amount ?? checkout.amount ?? d.amount));
  const transactionId = txn?.id ?? null;

  // ── Claim the draft ───────────────────────────────────────────────────────
  // A conditional UPDATE is the lock: only one caller can move it off "open".
  const { data: claimed } = await admin
    .from("checkout_drafts")
    .update({ status: "completing", transaction_id: transactionId })
    .eq("id", d.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    // Someone else is mid-flight. Give them a moment, then report what landed.
    for (let i = 0; i < 6; i++) {
      await sleep(600);
      const { data: again } = await admin
        .from("checkout_drafts")
        .select("id, session_id, payload, amount, website_slug, status, booking_id, booking_number")
        .eq("id", d.id)
        .maybeSingle();
      if (again?.booking_id && again.booking_number) {
        return await describeExisting(admin, again as DraftRow);
      }
    }
    return { ok: true, pending: true, paid: true, fare: amountPaid, receiptUrl };
  }

  // ── Create the booking ────────────────────────────────────────────────────
  const input = d.payload;
  const invalid = validateBookingInput(input);
  if (invalid) {
    await failDraft(admin, d.id, `Saved trip details were invalid (${invalid})`);
    return { ok: false, error: invalid };
  }

  const apiKey = await getWebsiteKey(d.website_slug ?? input.site ?? "main");
  if (!apiKey) {
    await failDraft(admin, d.id, "The website this booking came from is no longer active.");
    return { ok: false, error: "invalid_website" };
  }

  const created = await createTrip({ ...input, payment_method: "card" }, apiKey);
  if ("error" in created) {
    // Money is in but the booking would not save. Put it back to open so a
    // retry (or the webhook) can try again, and make sure a human sees it.
    await failDraft(admin, d.id, created.error.error ?? "create_booking failed");
    await flagOrphanPayment(admin, transactionId, amountPaid, receiptUrl);
    return { ok: false, error: created.error.error ?? "booking_failed" };
  }

  const outboundId = created.outbound.booking_id ?? null;
  const returnId = created.return?.ok ? created.return.booking_id ?? null : null;

  // Mark paid on every leg of the trip.
  const paidFields = { payment_status: "paid", sumup_transaction_id: transactionId };
  if (created.tripGroupId) {
    await admin.from("bookings").update(paidFields).eq("trip_group_id", created.tripGroupId);
  } else if (outboundId) {
    await admin.from("bookings").update(paidFields).eq("id", outboundId);
  }

  // The customer owes what they agreed to pay. If the trip re-priced between
  // the quote and now (traffic, a re-route), the charged amount wins.
  if (Math.abs(amountPaid - created.total) > 0.01 && outboundId) {
    if (returnId) {
      const half = created.total > 0 ? created.total / 2 : 0;
      const { out, ret } = splitFare(amountPaid, half, half);
      await setLegFare(admin, outboundId, out, amountPaid);
      await setLegFare(admin, returnId, ret, amountPaid);
    } else {
      await setLegFare(admin, outboundId, amountPaid, amountPaid);
    }
  }

  if (transactionId) {
    const { error: payErr } = await admin.from("payments").insert({
      booking_id: outboundId,
      amount: amountPaid,
      method: "card",
      status: "paid",
      currency: "gbp",
      sumup_transaction_id: transactionId,
      receipt_url: receiptUrl,
    });
    // 23505 = the webhook already wrote it. Attach the booking and move on.
    if (payErr?.code === "23505") {
      await admin
        .from("payments")
        .update({ booking_id: outboundId, receipt_url: receiptUrl, needs_review: false, review_reason: null })
        .eq("sumup_transaction_id", transactionId);
    } else if (payErr) {
      console.error("[checkout] could not write payment row", payErr);
    }
  }

  await admin
    .from("checkout_drafts")
    .update({
      status: "completed",
      booking_id: outboundId,
      booking_number: created.outbound.booking_number ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", d.id);

  // Emails, SMS and the activity log — never allowed to fail the booking.
  await notifyBooking({
    input: { ...input, payment_method: "card" },
    trip: created,
    totalFare: amountPaid,
    paid: true,
    origin,
  });

  return {
    ok: true,
    bookingNumber: created.outbound.booking_number ?? undefined,
    returnBookingNumber: created.return?.booking_number ?? null,
    fare: amountPaid,
    paid: true,
    receiptUrl,
  };
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Report a draft that was already redeemed, without touching SumUp again. */
async function describeExisting(admin: Admin, d: DraftRow): Promise<RedeemResult> {
  const { data: booking } = await admin
    .from("bookings")
    .select("booking_number, estimated_fare, trip_group_id")
    .eq("id", d.booking_id!)
    .maybeSingle();

  let returnNumber: string | null = null;
  if (booking?.trip_group_id) {
    const { data: other } = await admin
      .from("bookings")
      .select("booking_number")
      .eq("trip_group_id", booking.trip_group_id)
      .neq("id", d.booking_id!)
      .maybeSingle();
    returnNumber = other?.booking_number ?? null;
  }

  const { data: payment } = await admin
    .from("payments")
    .select("receipt_url, amount")
    .eq("booking_id", d.booking_id!)
    .maybeSingle();

  return {
    ok: true,
    bookingNumber: d.booking_number ?? booking?.booking_number ?? undefined,
    returnBookingNumber: returnNumber,
    fare: Number(payment?.amount ?? d.amount) || 0,
    paid: true,
    receiptUrl: payment?.receipt_url ?? null,
  };
}

/** Hand the draft back so another attempt can pick it up. */
async function failDraft(admin: Admin, id: string, reason: string) {
  console.error("[checkout] redemption failed", id, reason);
  await admin.from("checkout_drafts").update({ status: "open" }).eq("id", id);
}

/**
 * Paid, but no booking. This is the outcome that must never be silent — the
 * existing payments/needs_review machinery puts it on the Payments page and
 * emails staff through the sweep.
 */
async function flagOrphanPayment(
  admin: Admin,
  transactionId: string | null,
  amount: number,
  receiptUrl: string | null
) {
  if (!transactionId) return;
  const reason =
    "The customer paid on SumUp but the booking could not be saved. Refund them or create the booking by hand.";
  const { error } = await admin.from("payments").insert({
    booking_id: null,
    amount,
    method: "card",
    status: "paid",
    sumup_transaction_id: transactionId,
    receipt_url: receiptUrl,
    needs_review: true,
    review_reason: reason,
  });
  if (error && error.code !== "23505") console.error("[checkout] could not flag orphan payment", error);
  await admin.from("activity_logs").insert({
    action: "payment_unmatched",
    description: `Checkout payment of ${amount.toFixed(2)} could not be turned into a booking (${transactionId})`,
    metadata: { transaction: transactionId, amount },
  });
}

async function setLegFare(admin: Admin, bookingId: string, fare: number, tripTotal: number) {
  await admin
    .from("bookings")
    .update({
      estimated_fare: fare,
      fare_breakdown: {
        total: fare,
        charged: true,
        trip_total: tripTotal,
        note: "Set to the amount actually charged on SumUp",
      },
    })
    .eq("id", bookingId);
}
