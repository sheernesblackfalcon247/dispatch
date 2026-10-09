"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  CreditCard,
  AlertTriangle,
  ExternalLink,
  ReceiptText,
  ShieldAlert,
  RefreshCw,
  Link2Off,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { money, dateTime, timeAgo, cn } from "@/lib/format";

interface Payment {
  id: string;
  amount: number;
  amount_refunded: number | null;
  currency: string | null;
  method: string;
  status: "pending" | "paid" | "failed" | "refunded";
  needs_review: boolean;
  review_reason: string | null;
  failure_reason: string | null;
  disputed_at: string | null;
  receipt_url: string | null;
  sumup_transaction_id: string | null;
  booking_id: string | null;
  created_at: string;
  refunded_at: string | null;
  bookings: {
    booking_number: string;
    customer_name: string;
    customer_email: string | null;
    status: string;
  } | null;
}

interface Summary {
  count: number;
  collected: number;
  refunded: number;
  needs_review: number;
  unmatched: number;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "unmatched", label: "Unmatched" },
  { key: "refunded", label: "Refunded" },
  { key: "failed", label: "Failed" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700",
  refunded: "bg-gray-100 text-gray-600",
  failed: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-700",
};

export default function PaymentsPage() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/payments?filter=${filter}`);
      const data = await res.json();
      if (!data?.ok) {
        setSetupError(data?.detail ?? data?.error ?? "Could not load payments.");
        setRows([]);
        setSummary(null);
      } else {
        setSetupError(null);
        setRows(data.payments as Payment[]);
        setSummary(data.summary as Summary);
      }
    } catch {
      setSetupError("Could not reach the server.");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Every payment taken — card through SumUp, cash collected by drivers. Refunds are made in the SumUp Dashboard."
        action={
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:text-ink-950"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
        }
      />

      <div className="px-5 pb-10 md:px-8">
        {setupError && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-amber-900">Payments table not ready</p>
              <p className="mt-0.5 text-amber-800">
                Run <code className="rounded bg-amber-100 px-1">db/2026-10-09_sumup.sql</code> in the
                Supabase SQL editor, then refresh this page.
              </p>
              <p className="mt-1 break-words font-mono text-xs text-amber-700">{setupError}</p>
            </div>
          </div>
        )}

        {summary && (
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Collected" value={money(summary.collected)} tone="text-emerald-600" />
            <Tile label="Refunded" value={money(summary.refunded)} tone="text-gray-500" />
            <Tile
              label="Needs review"
              value={String(summary.needs_review)}
              tone={summary.needs_review ? "text-red-600" : "text-gray-400"}
            />
            <Tile
              label="No booking"
              value={String(summary.unmatched)}
              tone={summary.unmatched ? "text-red-600" : "text-gray-400"}
            />
          </div>
        )}

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-ink-950 text-white"
                  : "border border-gray-200 bg-white text-gray-500 hover:text-ink-950"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">
            {setupError ? "—" : "No payments here yet."}
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((p, i) => (
              <PaymentCard key={p.id} p={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-bold", tone)}>{value}</p>
    </div>
  );
}

/**
 * Refunds are deliberately not offered here: money goes back to customers only
 * from the SumUp Dashboard, by whoever holds that login. Staff record the
 * outcome on the booking (job status "Refunded").
 */
function PaymentCard({ p, index }: { p: Payment; index: number }) {
  const refundedSoFar = Number(p.amount_refunded ?? 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm",
        p.needs_review ? "border-red-200" : "border-gray-100"
      )}
    >
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            p.needs_review ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-500"
          )}
        >
          {p.needs_review ? <AlertTriangle className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-bold text-ink-950">{money(p.amount)}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[p.status])}>
              {p.status}
            </span>
            {refundedSoFar > 0 && p.status !== "refunded" && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                {money(refundedSoFar)} refunded
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-600">
              {p.method}
            </span>
            {p.disputed_at && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                disputed
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-sm text-gray-600">
            {p.bookings ? (
              <>
                <span className="font-mono text-xs text-gray-500">{p.bookings.booking_number}</span>
                {" · "}
                {p.bookings.customer_name}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-red-600">
                <Link2Off className="h-3.5 w-3.5" /> No booking attached
              </span>
            )}
          </p>

          <p className="mt-0.5 text-xs text-gray-400" title={dateTime(p.created_at)}>
            {timeAgo(p.created_at)}
            {p.sumup_transaction_id && (
              <span className="ml-2 font-mono text-[11px] text-gray-300">{p.sumup_transaction_id}</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {p.receipt_url && (
            <a
              href={p.receipt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-xl border border-gray-200 px-2.5 py-2 text-xs font-medium text-gray-500 hover:text-ink-950"
            >
              <ReceiptText className="h-4 w-4" /> Receipt
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {(p.review_reason || p.failure_reason) && (
        <p
          className={cn(
            "border-t px-4 py-2.5 text-[13px]",
            p.needs_review ? "border-red-100 bg-red-50/60 text-red-800" : "border-gray-100 bg-gray-50 text-gray-600"
          )}
        >
          {p.review_reason ?? p.failure_reason}
        </p>
      )}

    </motion.div>
  );
}
