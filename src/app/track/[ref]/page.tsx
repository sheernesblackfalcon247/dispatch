"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Car,
  Phone,
  Star,
  Loader2,
  CheckCircle2,
  MapPin,
  Navigation,
  XCircle,
  Clock,
  CalendarClock,
  CircleDot,
  Repeat,
  ArrowLeft,
} from "lucide-react";
import { money, cn, dateTimeWithDay } from "@/lib/format";
import InstallPWA from "@/components/InstallPWA";
import type { BookingStatus, PaymentMethod } from "@/lib/types";

interface Ride {
  ok: boolean;
  error?: string;
  booking_number: string;
  status: BookingStatus;
  customer_name: string;
  pickup_address: string;
  dropoff_address: string;
  via_points: { address: string }[];
  is_return: boolean;
  linked_booking: string | null;
  estimated_fare: number;
  payment_method: PaymentMethod;
  scheduled_at: string | null;
  driver: {
    name: string;
    phone: string | null;
    /** Null for an outside driver — they have no history with us to rate. */
    rating: number | null;
    vehicle: string | null;
    plate: string | null;
    external?: boolean;
  } | null;
  rated: boolean;
}

const STEPS = [
  { key: "received", label: "Booking received", hint: "Confirming your booking…" },
  { key: "assigned", label: "Driver on the way", hint: "Your driver is heading to pick you up…" },
  { key: "arrived", label: "Driver arrived", hint: "Your driver is waiting at the pickup point…" },
  { key: "trip", label: "On the trip", hint: "On the way to your destination…" },
  { key: "done", label: "Completed", hint: "" },
];

function stepIndex(status: BookingStatus): number {
  switch (status) {
    case "pending":
      return 0;
    case "assigned":
    case "accepted":
      return 1;
    case "driver_arrived":
      return 2;
    case "in_progress":
      return 3;
    case "completed":
      return 4;
    default:
      return -1;
  }
}

/**
 * "Back" on a page that is usually opened from an email or SMS link, where
 * there is nothing to go back to — so it steps back through history only when
 * this tab actually has some, and otherwise takes the customer to the homepage.
 */
function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className="mb-1 flex items-center gap-1 px-1 text-sm text-gray-500 transition-colors hover:text-ink-950"
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}

export default function TrackPage() {
  const params = useParams();
  const ref = decodeURIComponent(String(params.ref));
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const statusRef = useRef<string | null>(null);
  const TERMINAL = ["completed", "cancelled", "declined", "no_driver_found"];

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const data = await res.json();
    setLoading(false);
    if (!data.ok) {
      setNotFound(true);
      return;
    }
    setRide(data as Ride);
    statusRef.current = data.status;
  }, [ref]);

  // Poll every 5s; stop once the ride reaches a terminal state.
  useEffect(() => {
    fetchStatus();
    const t = setInterval(() => {
      if (statusRef.current && TERMINAL.includes(statusRef.current)) {
        clearInterval(t);
        return;
      }
      fetchStatus();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </main>
    );
  }

  if (notFound || !ride) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <XCircle className="mb-3 h-12 w-12 text-gray-300" />
        <h1 className="font-display text-xl font-bold text-ink-950">Booking not found</h1>
        <p className="mt-1 text-sm text-gray-500">Check your booking number and try again.</p>
        <div className="mt-4">
          <BackButton />
        </div>
      </main>
    );
  }

  const cancelled = ["cancelled", "declined", "no_driver_found"].includes(ride.status);
  const idx = stepIndex(ride.status);
  const finished = ride.status === "completed";

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50/40 to-white p-4">
      <div className="mx-auto max-w-md">
        <div className="pt-2">
          <BackButton />
        </div>

        {/* Header */}
        <div className="mb-4 flex items-center justify-between px-1 pt-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500">
              <Car className="h-5 w-5 text-white" strokeWidth={2.3} />
            </div>
            <div>
              <p className="font-display text-base font-bold leading-tight text-ink-950">Track your ride</p>
              <p className="font-mono text-xs text-gray-400">{ride.booking_number}</p>
            </div>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-ink-950 shadow-sm">
            {money(ride.estimated_fare)}
          </span>
        </div>

        {ride.scheduled_at && ["pending", "assigned", "accepted"].includes(ride.status) && (
          <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            <CalendarClock className="h-5 w-5 shrink-0" />
            <span>
              Scheduled pickup:{" "}
              <b>
                {dateTimeWithDay(ride.scheduled_at)}
              </b>
            </span>
          </div>
        )}

        {cancelled ? (
          <div className="rounded-3xl border border-red-100 bg-white p-8 text-center shadow-sm">
            <XCircle className="mx-auto mb-3 h-12 w-12 text-red-400" />
            <h2 className="font-display text-xl font-bold text-ink-950">
              {ride.status === "no_driver_found" ? "No driver available" : "Ride cancelled"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">Please book again or contact support.</p>
          </div>
        ) : (
          <>
            {/* Timeline */}
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              {STEPS.map((s, i) => {
                // When the ride is completed, the final step is done (not active),
                // so it shows a green check instead of a pulsing "In progress…".
                const done = finished ? i <= idx : i < idx;
                const active = !finished && i === idx;
                return (
                  <div key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <motion.div
                        initial={false}
                        animate={{ scale: active ? 1.1 : 1 }}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors",
                          done ? "bg-green-500" : active ? "bg-brand-500" : "bg-gray-200"
                        )}
                      >
                        {done ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : active ? (
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                          </span>
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-white" />
                        )}
                      </motion.div>
                      {i < STEPS.length - 1 && (
                        <span className={cn("my-1 w-0.5 flex-1 min-h-[24px]", done ? "bg-green-500" : "bg-gray-200")} />
                      )}
                    </div>
                    <div className={cn("pb-4", i === STEPS.length - 1 && "pb-0")}>
                      <p className={cn("text-sm font-semibold", active || done ? "text-ink-950" : "text-gray-400")}>
                        {s.label}
                      </p>
                      {active && s.hint && <p className="text-xs text-brand-600">{s.hint}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Driver card */}
            {ride.driver && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"
              >
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Your driver</p>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
                    {ride.driver.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-ink-950">{ride.driver.name}</p>
                    {ride.driver.rating != null ? (
                      <p className="flex items-center gap-1 text-xs text-gray-500">
                        <Star className="h-3 w-3 fill-brand-400 text-brand-400" />{" "}
                        {Number(ride.driver.rating).toFixed(1)}
                        {ride.driver.vehicle && ` · ${ride.driver.vehicle}`}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Partner driver{ride.driver.vehicle ? ` · ${ride.driver.vehicle}` : ""}
                      </p>
                    )}
                  </div>
                  {ride.driver.phone && (
                    <a href={`tel:${ride.driver.phone}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 text-white shadow-md">
                      <Phone className="h-5 w-5" />
                    </a>
                  )}
                </div>
                {ride.driver.plate && (
                  <div className="mt-3 flex items-center justify-center rounded-xl bg-ink-950 py-2 font-mono text-sm font-bold tracking-widest text-white">
                    {ride.driver.plate}
                  </div>
                )}
              </motion.div>
            )}

            {/* Route */}
            <div className="mt-4 space-y-3 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <div>
                  <p className="text-xs text-gray-400">Pick-up</p>
                  <p className="text-sm text-ink-950">{ride.pickup_address}</p>
                </div>
              </div>
              {(ride.via_points ?? []).map((v, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-400">Via</p>
                    <p className="text-sm text-gray-600">{v.address}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-2.5">
                <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-ink-950" />
                <div>
                  <p className="text-xs text-gray-400">Drop-off</p>
                  <p className="text-sm text-ink-950">{ride.dropoff_address}</p>
                </div>
              </div>
            </div>

            {ride.linked_booking && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                <Repeat className="h-4 w-4 shrink-0" />
                <span>
                  {ride.is_return ? "Return trip" : "Return booked"} · other leg:{" "}
                  <a href={`/track/${ride.linked_booking}`} className="font-semibold underline">
                    {ride.linked_booking}
                  </a>
                </span>
              </div>
            )}

            {/* Rating */}
            {ride.status === "completed" && (
              <RatingBox ref_={ride.booking_number} alreadyRated={ride.rated} onDone={fetchStatus} />
            )}
          </>
        )}

        <InstallPWA />

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-gray-400">
          <Clock className="h-3 w-3" /> Updates automatically · Black Falcon 247 Taxi
        </p>
      </div>
    </main>
  );
}

function RatingBox({ ref_, alreadyRated, onDone }: { ref_: string; alreadyRated: boolean; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(alreadyRated);

  const submit = async () => {
    if (!rating) return;
    setSaving(true);
    const res = await fetch("/api/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: ref_, rating, comment }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok || data.error === "already_rated") {
      setDone(true);
      onDone();
    }
  };

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-3xl border border-green-100 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" />
        <p className="font-semibold text-ink-950">Thanks for your feedback!</p>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
      <p className="text-center font-display font-bold text-ink-950">How was your ride?</p>
      <div className="my-4 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}>
            <Star
              className={cn(
                "h-9 w-9 transition-all",
                n <= (hover || rating) ? "scale-110 fill-brand-400 text-brand-400" : "text-gray-200"
              )}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Leave a comment (optional)"
        rows={2}
        className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
      />
      <button
        onClick={submit}
        disabled={!rating || saving}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 font-semibold text-white transition-colors hover:bg-brand-600 disabled:bg-gray-200"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit rating"}
      </button>
    </motion.div>
  );
}
