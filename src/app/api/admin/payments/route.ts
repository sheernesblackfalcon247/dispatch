import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepUnmatchedPayments } from "@/lib/paymentAlerts";

/**
 * Admin-only card payment ledger.
 *
 * Read through the service role rather than the browser's Supabase client so
 * the `payments` table never needs a public RLS policy — money stays server-side.
 * Opening the page also runs the unmatched-payment sweep, which is how staff get
 * chased about an orphaned payment on a quiet day with no webhook traffic.
 */
export async function GET(req: Request) {
  const me = await getSessionProfile();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "no_service_role_key" });
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "all";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500);

  let q = admin
    .from("payments")
    .select(
      "id, amount, amount_refunded, currency, method, status, needs_review, review_reason, failure_reason, disputed_at, receipt_url, sumup_transaction_id, booking_id, created_at, refunded_at, bookings(booking_number, customer_name, customer_email, status, scheduled_at)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filter === "review") q = q.eq("needs_review", true);
  else if (filter === "unmatched") q = q.is("booking_id", null);
  else if (filter === "refunded") q = q.eq("status", "refunded");
  else if (filter === "failed") q = q.eq("status", "failed");

  const { data, error } = await q;
  if (error) {
    // Almost always "column does not exist" — the hardening migration has not
    // been run against this database yet. Say so instead of showing an empty page.
    console.error("[admin/payments] query failed", error);
    return NextResponse.json({ ok: false, error: "query_failed", detail: error.message });
  }

  const rows = (data ?? []) as unknown as PaymentRow[];
  const paid = rows.filter((r) => r.status === "paid");
  const summary = {
    count: rows.length,
    collected: round(paid.reduce((s, r) => s + Number(r.amount || 0), 0)),
    refunded: round(rows.reduce((s, r) => s + Number(r.amount_refunded || 0), 0)),
    needs_review: rows.filter((r) => r.needs_review).length,
    unmatched: rows.filter((r) => !r.booking_id && r.status === "paid").length,
  };

  // Best-effort, never blocks the response payload being correct.
  void sweepUnmatchedPayments(url.origin).catch(() => {});

  return NextResponse.json({ ok: true, payments: rows, summary });
}

interface PaymentRow {
  id: string;
  amount: number;
  amount_refunded: number | null;
  status: string;
  needs_review: boolean;
  booking_id: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;
