"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, MapPin, CreditCard, XCircle, Car } from "lucide-react";
import InstallPWA from "@/components/InstallPWA";
import { money } from "@/lib/format";
import { forgetCheckout } from "@/lib/checkoutSession";

interface Result {
  ok: boolean;
  pending?: boolean;
  error?: string;
  bookingNumber?: string;
  returnBookingNumber?: string | null;
  fare?: number;
  receiptUrl?: string | null;
}

/**
 * Where Stripe sends the customer after paying.
 *
 * The booking does not exist yet when this page opens — it is created here, from
 * the trip parked before checkout. The webhook is doing the same thing in
 * parallel; whichever wins, this page waits and then shows the confirmation, so
 * the customer never sees a blank screen after handing over money.
 */
export default function BookingCompletePage() {
  return (
    <Suspense fallback={<Waiting />}>
      <Complete />
    </Suspense>
  );
}

function Complete() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setResult({ ok: false, error: "missing_session" });
      return;
    }
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      // The webhook may be creating the booking right now. Keep asking until it
      // lands rather than telling the customer something went wrong.
      for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/payment/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const data = (await res.json()) as Result;
          if (cancelled) return;
          setResult(data);
          if (data.ok && data.bookingNumber) {
            // Paid and booked — this tab has no half-finished checkout any more,
            // so "Book another ride" starts from a clean form.
            forgetCheckout();
          }
          if (!(data.ok && data.pending)) return; // settled, one way or the other
        } catch {
          if (cancelled) return;
          if (attempt >= 4) {
            setResult({ ok: false, error: "network" });
            return;
          }
        }
        await sleep(1500);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!result || (result.ok && result.pending)) return <Waiting />;
  if (!result.ok || !result.bookingNumber) return <Problem error={result.error} />;

  return (
    <Shell>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100"
        >
          <CheckCircle2 className="h-9 w-9 text-green-600" strokeWidth={2.2} />
        </motion.div>

        <h1 className="font-display text-2xl font-bold text-ink-950">
          {result.returnBookingNumber ? "Rides booked!" : "Ride booked!"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Payment received. We&apos;ll assign a driver shortly and message you on WhatsApp.
        </p>

        <div className="mt-5 space-y-2 rounded-2xl bg-gray-50 p-4 text-left">
          <Row label="Outbound no." value={result.bookingNumber} />
          {result.returnBookingNumber && <Row label="Return no." value={result.returnBookingNumber} />}
          <Row label="Total paid" value={money(result.fare ?? 0)} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Payment</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Paid by card
            </span>
          </div>
        </div>

        {result.receiptUrl && (
          <a
            href={result.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-gray-50"
          >
            <CreditCard className="h-4 w-4" /> View receipt
          </a>
        )}

        <a
          href={`/track/${result.bookingNumber}`}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 font-semibold text-white shadow-lg shadow-brand-500/30 transition-colors hover:bg-brand-600"
        >
          <MapPin className="h-5 w-5" /> Track your ride
        </a>
        <a
          href="/book"
          className="mt-2.5 flex w-full items-center justify-center rounded-xl border border-gray-200 py-3 font-semibold text-ink-950 transition-colors hover:bg-gray-50"
        >
          Book another ride
        </a>

        <div className="mt-5">
          <InstallPWA />
        </div>
      </motion.div>
    </Shell>
  );
}

function Waiting() {
  return (
    <Shell>
      <div className="py-8 text-center">
        <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-brand-500" />
        <h1 className="font-display text-xl font-bold text-ink-950">Payment received</h1>
        <p className="mt-1 text-sm text-gray-500">
          Creating your booking — this takes a few seconds. Please don&apos;t close this page.
        </p>
      </div>
    </Shell>
  );
}

const PROBLEMS: Record<string, { title: string; body: string }> = {
  not_paid: {
    title: "Payment not completed",
    body: "Stripe hasn't confirmed a payment for this checkout, so nothing has been charged and no booking was made. You can start again whenever you're ready.",
  },
  unknown_session: {
    title: "We couldn't find this checkout",
    body: "This payment link has expired or was already used. If money left your account, contact us with the time of payment and we'll sort it out straight away.",
  },
  missing_session: {
    title: "Something went missing",
    body: "This page was opened without a payment reference. If you've just paid, check your email for the confirmation.",
  },
};

function Problem({ error }: { error?: string }) {
  const copy = PROBLEMS[error ?? ""] ?? {
    title: "We're finishing your booking",
    body: "Your payment went through but we hit a snag saving the booking. Our team has already been alerted and will call you shortly — please don't pay again.",
  };
  const reassuring = !PROBLEMS[error ?? ""] || error === "unknown_session";

  return (
    <Shell>
      <div className="py-6 text-center">
        <div
          className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
            reassuring ? "bg-amber-100" : "bg-gray-100"
          }`}
        >
          <XCircle className={`h-9 w-9 ${reassuring ? "text-amber-600" : "text-gray-400"}`} />
        </div>
        <h1 className="font-display text-xl font-bold text-ink-950">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{copy.body}</p>
        <a
          href="/book"
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-brand-500 py-3 font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Back to booking
        </a>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/40 to-white p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500">
            <Car className="h-5 w-5 text-white" strokeWidth={2.3} />
          </div>
          <span className="font-display text-base font-bold text-ink-950">Black Falcon 247 Taxi</span>
        </div>
        <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-ink-950">{value}</span>
    </div>
  );
}
