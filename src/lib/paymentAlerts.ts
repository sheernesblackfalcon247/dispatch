import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailEnabled } from "@/lib/email";
import { staffAlertRecipients } from "@/lib/notifyStaff";
import { paymentAlertEmail, type PaymentAlertData } from "@/lib/emailTemplates";

function siteOrigin(fallback?: string): string {
  return process.env.NEXT_PUBLIC_SITE_URL || fallback || "";
}

/**
 * Email admin/dispatch when money and bookings disagree. Best-effort: a failed
 * send must never break the request that triggered it — the payment row keeps
 * `alerted_at` null so the sweep below retries later.
 */
export async function alertStaffPayment(
  d: Omit<PaymentAlertData, "paymentsUrl">,
  origin?: string
): Promise<boolean> {
  try {
    if (!(await emailEnabled())) return false;
    const to = await staffAlertRecipients();
    if (!to.length) return false;
    const base = siteOrigin(origin);
    const mail = paymentAlertEmail({
      ...d,
      ...(base ? { paymentsUrl: `${base}/admin/payments` } : {}),
    });
    return await sendEmail({ to, subject: mail.subject, html: mail.html });
  } catch {
    return false;
  }
}

/** Payments older than this with no booking attached are treated as orphaned. */
const GRACE_MS = 10 * 60_000;

/**
 * Catch-up pass for payments that took money but never got an alert out —
 * orphans (no booking) and anything flagged for review.
 *
 * There is no cron in this app, so it is called opportunistically: on every
 * SumUp notification and whenever an admin opens the Payments page. The
 * `alerted_at` stamp makes it safe to run as often as we like.
 */
export async function sweepUnmatchedPayments(origin?: string): Promise<number> {
  let sent = 0;
  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - GRACE_MS).toISOString();

    await releaseStaleClaims(admin, cutoff);

    const { data: rows } = await admin
      .from("payments")
      .select("id, booking_id, amount, sumup_transaction_id, receipt_url, needs_review, review_reason, created_at")
      .eq("status", "paid")
      .is("alerted_at", null)
      .lt("created_at", cutoff)
      .or("booking_id.is.null,needs_review.is.true")
      .order("created_at", { ascending: true })
      .limit(25);

    for (const r of (rows ?? []) as {
      id: string;
      booking_id: string | null;
      amount: number;
      sumup_transaction_id: string | null;
      receipt_url: string | null;
      review_reason: string | null;
    }[]) {
      const ok = await alertStaffPayment(
        {
          kind: r.booking_id ? "review" : "unmatched",
          amount: Number(r.amount) || 0,
          transactionId: r.sumup_transaction_id ?? "(none)",
          reason:
            r.review_reason ||
            "The card was charged but no booking was ever attached to this payment.",
          receiptUrl: r.receipt_url,
        },
        origin
      );
      // Stamp either way once we have staff addresses — but only on a real send,
      // so a mail outage doesn't silently swallow the alert.
      if (ok) {
        await admin.from("payments").update({ alerted_at: new Date().toISOString() }).eq("id", r.id);
        sent++;
      }
    }
  } catch (err) {
    console.error("[payments] sweep failed", err);
  }
  return sent;
}

/**
 * Hand back checkout drafts that were claimed but never finished.
 *
 * Redeeming a paid checkout claims the draft by moving it to "completing". If
 * that process then dies — a serverless timeout, a deploy mid-request — the
 * draft would sit claimed forever and the customer's payment could never become
 * a booking. Anything still "completing" past the grace period is put back so
 * the next caller (the customer refreshing, or a webhook retry) can finish it.
 */
async function releaseStaleClaims(admin: ReturnType<typeof createAdminClient>, cutoff: string) {
  const { data, error } = await admin
    .from("checkout_drafts")
    .update({ status: "open" })
    .eq("status", "completing")
    .is("booking_id", null)
    .lt("created_at", cutoff)
    .select("id");
  if (error) {
    console.error("[payments] could not release stale checkout claims", error);
    return;
  }
  if (data?.length) {
    console.warn(`[payments] released ${data.length} stuck checkout draft(s) for retry`);
  }
}
