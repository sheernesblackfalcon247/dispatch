"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, dateTime, cn } from "@/lib/format";
import type { BookingStatus } from "@/lib/types";

/**
 * A printable bookings report.
 *
 * There is no PDF library here on purpose: every browser can already turn a
 * page into a PDF, and its output is selectable, searchable text at whatever
 * paper size the user wants. So this renders a clean table, hides the admin
 * navigation with `print:` rules, and opens the print dialog — "Save as PDF"
 * does the rest, with nothing shipped to the browser to make it work.
 */

interface Row {
  id: string;
  booking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  pickup_address: string;
  dropoff_address: string;
  status: BookingStatus;
  payment_method: string;
  payment_status: string;
  estimated_fare: number | null;
  final_fare: number | null;
  external_provider: string | null;
  scheduled_at: string | null;
  created_at: string;
  driver?: { full_name: string } | null;
}

export default function BookingsPrintPage() {
  return (
    <Suspense fallback={<Centered>Preparing report…</Centered>}>
      <Report />
    </Suspense>
  );
}

function Report() {
  const params = useSearchParams();
  const supabase = createClient();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const status = params.get("status") ?? "all";

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase
      .from("bookings")
      .select(
        "id, booking_number, customer_name, customer_whatsapp, pickup_address, dropoff_address, status, payment_method, payment_status, estimated_fare, final_fare, external_provider, scheduled_at, created_at, driver:drivers(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(2000);

    // The report is about when rides happened, so it filters on the ride's own
    // date — the scheduled time where there is one, otherwise when it was taken.
    if (from) q = q.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) q = q.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
    if (status !== "all") q = q.eq("status", status);

    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      setRows([]);
      return;
    }
    setRows((data as unknown as Row[]) ?? []);
  }, [supabase, from, to, status]);

  useEffect(() => {
    load();
  }, [load]);

  // Only open the print dialog once there is something on the page to print.
  useEffect(() => {
    if (rows && rows.length >= 0 && !error) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [rows, error]);

  if (!rows) return <Centered>Loading bookings…</Centered>;

  const fareOf = (r: Row) => Number(r.final_fare ?? r.estimated_fare ?? 0);
  const completed = rows.filter((r) => r.status === "completed");
  const takings = completed.reduce((s, r) => s + fareOf(r), 0);
  const outstanding = rows
    .filter((r) => r.payment_status !== "paid" && r.status !== "cancelled")
    .reduce((s, r) => s + fareOf(r), 0);

  const rangeLabel =
    from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : "All dates";

  return (
    <div className="bg-white px-5 py-6 text-ink-950 md:px-8 print:px-0 print:py-0">
      {/* Screen-only controls */}
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:text-ink-950"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-xl bg-ink-950 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800"
        >
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
        <p className="text-xs text-gray-500">
          In the print dialog choose <b>Save as PDF</b> as the destination.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not load the bookings: {error}
        </p>
      )}

      {/* Report header */}
      <div className="mb-5 border-b border-gray-300 pb-4">
        <h1 className="font-display text-2xl font-bold">Bookings report</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {rangeLabel}
          {status !== "all" && ` · ${status.replace("_", " ")} only`}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">Generated {dateTime(new Date().toISOString())}</p>
      </div>

      {/* Totals */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Bookings" value={String(rows.length)} />
        <Tile label="Completed" value={String(completed.length)} />
        <Tile label="Completed takings" value={money(takings)} />
        <Tile label="Still owed" value={money(outstanding)} />
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">No bookings in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left">
              <Th>Ref</Th>
              <Th>Date</Th>
              <Th>Customer</Th>
              <Th>Journey</Th>
              <Th>Driver</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th className="text-right">Fare</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-200 align-top">
                <Td className="whitespace-nowrap font-mono">{r.booking_number}</Td>
                <Td className="whitespace-nowrap">{dateTime(r.scheduled_at ?? r.created_at)}</Td>
                <Td>
                  {r.customer_name}
                  <br />
                  <span className="text-gray-500">{r.customer_whatsapp}</span>
                </Td>
                <Td>
                  {r.pickup_address}
                  <br />
                  <span className="text-gray-500">→ {r.dropoff_address}</span>
                </Td>
                <Td>
                  {r.driver?.full_name ??
                    (r.external_provider ? <span className="italic">Outside job</span> : "—")}
                </Td>
                <Td className="whitespace-nowrap capitalize">{r.status.replace("_", " ")}</Td>
                <Td className="whitespace-nowrap capitalize">
                  {r.payment_method}
                  <br />
                  <span className={cn(r.payment_status === "paid" ? "text-green-700" : "text-gray-500")}>
                    {r.payment_status}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-right font-semibold">{money(fareOf(r))}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-[10px] text-gray-400">
        Black Falcon 247 Taxi · {rows.length} booking{rows.length === 1 ? "" : "s"} · {rangeLabel}
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="font-display text-lg font-bold">{value}</p>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-1.5 py-2 font-semibold", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-1.5 py-2", className)}>{children}</td>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-gray-500">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      {children}
    </div>
  );
}
