/**
 * Is "pay by card" open to customers right now?
 *
 * Card payments are deliberately OFF unless someone turns them on. While the
 * site runs on SumUp sandbox keys a customer can complete a checkout and be told
 * "Paid by card" without a penny leaving their account — the booking looks
 * settled, a driver goes out, and the fare is never collected. Off-by-default
 * means that can only happen on purpose.
 *
 * Turn card payments on by setting, in Vercel → Environment Variables:
 *
 *     NEXT_PUBLIC_CARD_PAYMENTS = on
 *
 * and redeploy. Anything else — "off", empty, missing — means cash only.
 *
 * NEXT_PUBLIC_ so the booking widget can hide the Card button in the browser;
 * /api/payment/checkout checks the same flag so a hand-crafted request can't
 * start a checkout that the UI refuses to offer.
 */
export function cardPaymentsEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_CARD_PAYMENTS ?? "").trim().toLowerCase() === "on";
}
