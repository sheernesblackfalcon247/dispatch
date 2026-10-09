"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  MapPin,
  Navigation,
  User,
  Phone,
  Mail,
  Baby,
  Banknote,
  CreditCard,
  Lock,
  Loader2,
  CheckCircle2,
  Check,
  ArrowRight,
  ArrowLeft,
  Users,
  Luggage,
  Backpack,
  Car,
  Route,
  Clock,
  CalendarClock,
  Plus,
  X,
  CircleDot,
  Repeat,
  Map as MapIcon,
  ChevronDown,
  Minus,
} from "lucide-react";
import AddressAutocomplete, { type PlaceValue } from "@/components/booking/AddressAutocomplete";
import RouteMap, { type RouteLeg } from "@/components/booking/RouteMap";
import { carIcon } from "@/components/booking/CarIcon";
import { money, isValidPhone } from "@/lib/format";
import { rememberCheckout, rememberedCheckout, forgetCheckout } from "@/lib/checkoutSession";
import { cardPaymentsEnabled } from "@/lib/paymentMethods";
import type { FareBreakdown, PaymentMethod } from "@/lib/types";

interface Quote {
  category_id: string;
  name: string;
  description: string | null;
  icon: string;
  capacity: number;
  suitcases: number;
  hand_bags: number;
  fare: FareBreakdown;
  return_fare: FareBreakdown | null;
  outbound_total: number;
  return_total: number;
  total: number;
}

interface Journey {
  pickup: PlaceValue;
  vias: PlaceValue[];
  dropoff: PlaceValue;
  km: number | null;
  min: number | null;
}

const empty: PlaceValue = { address: "", lat: null, lng: null };
const emptyJourney: Journey = { pickup: empty, vias: [], dropoff: empty, km: null, min: null };

const emailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/**
 * Leave for SumUp's hosted checkout.
 *
 * The widget is often running inside an iframe on a partner's website, and
 * a hosted payment page (rightly) refuses to render inside one — so the whole browser goes,
 * not just the frame. If the frame isn't allowed to navigate its parent we fall
 * back to a new tab rather than stranding the customer on a dead button.
 */
const goToCheckout = (url: string) => {
  try {
    const top = window.top;
    if (top && top !== window.self) {
      top.location.href = url;
      return;
    }
  } catch {
    window.open(url, "_blank", "noopener");
    return;
  }
  window.location.href = url;
};

/** ISO timestamp → the value a <input type="datetime-local"> expects. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface DraftLeg {
  pickup_address?: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_address?: string;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  via_points?: { address?: string; lat?: number | null; lng?: number | null }[];
  distance_km?: number | null;
  duration_min?: number | null;
  scheduled_at?: string | null;
}

/** Rebuild the form's trip from a parked checkout draft. */
const journeyFrom = (leg: DraftLeg): Journey => ({
  pickup: { address: leg.pickup_address ?? "", lat: leg.pickup_lat ?? null, lng: leg.pickup_lng ?? null },
  vias: (leg.via_points ?? []).map((v) => ({
    address: v.address ?? "",
    lat: v.lat ?? null,
    lng: v.lng ?? null,
  })),
  dropoff: { address: leg.dropoff_address ?? "", lat: leg.dropoff_lat ?? null, lng: leg.dropoff_lng ?? null },
  // `|| null`, not `?? null`: a stored 0 means "we never had a distance", and
  // null is what makes the widget re-measure the route instead of sitting on a
  // £0 trip it refuses to quote.
  km: leg.distance_km || null,
  min: leg.duration_min || null,
});

const allCoords = (j: Journey) =>
  j.pickup.lat != null && j.dropoff.lat != null && j.vias.every((v) => v.lat != null);

const routeText = (j: Journey) =>
  [j.pickup.address, ...j.vias.map((v) => v.address), j.dropoff.address].filter(Boolean).join(" ");

// Pricing legs carry coordinates too, so the server can re-derive distance and
// the quoted/charged price can't be lowered by a tampered distance_km.
const priceLeg = (j: Journey, at: string | null) => ({
  distance_km: j.km,
  duration_min: j.min,
  route_text: routeText(j),
  scheduled_at: at,
  pickup_lat: j.pickup.lat,
  pickup_lng: j.pickup.lng,
  dropoff_lat: j.dropoff.lat,
  dropoff_lng: j.dropoff.lng,
  via_points: j.vias.map((v) => ({ lat: v.lat, lng: v.lng })),
});

async function getRoute(j: Journey): Promise<{ km: number; min: number } | null> {
  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: { lat: j.pickup.lat, lng: j.pickup.lng },
        destination: { lat: j.dropoff.lat, lng: j.dropoff.lng },
        waypoints: j.vias.filter((v) => v.lat != null).map((v) => ({ lat: v.lat, lng: v.lng })),
      }),
    });
    const d = await res.json();
    return d.ok ? { km: d.km, min: d.min } : null;
  } catch {
    return null;
  }
}

export default function BookingWidget({
  site = "main",
  embed = false,
  manual = false,
}: {
  site?: string;
  embed?: boolean;
  manual?: boolean;
}) {
  const [step, setStep] = useState(0); // 0 trip, 1 car, 2 details
  const [outbound, setOutbound] = useState<Journey>(emptyJourney);
  const [returnEnabled, setReturnEnabled] = useState(false);
  const [ret, setRet] = useState<Journey>(emptyJourney);

  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [returnAt, setReturnAt] = useState("");

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [hasReturnQuote, setHasReturnQuote] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [childSeatOn, setChildSeatOn] = useState(false);
  const [childSeatPrice, setChildSeatPrice] = useState(0);
  // Staff-only manual price override (discount / rush pricing). Ignored for public customers.
  const [customPrice, setCustomPrice] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [suitcases, setSuitcases] = useState(0);
  const [handLuggage, setHandLuggage] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    outbound: string;
    ret: string | null;
    fare: number;
  } | null>(null);

  // Card payment: we hand off to SumUp's own hosted page rather than taking
  // card details here, so all this tracks is "we are about to leave the site".
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Category to re-select once quotes come back, when resuming a cancelled checkout.
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);

  // Coming back from a cancelled SumUp checkout: refill everything the customer
  // already typed. Nobody should have to enter two addresses and a phone number
  // twice because they had second thoughts on the payment page.
  useEffect(() => {
    // An explicit ?resume=<draft id> link wins; the browser back button carries
    // nothing, so fall back to what this tab remembered on its way out.
    const explicit = new URLSearchParams(window.location.search).get("resume");
    const draftId = explicit ?? rememberedCheckout();
    if (!draftId) return;
    (async () => {
      try {
        const res = await fetch(`/api/payment/draft?id=${encodeURIComponent(draftId)}`);
        const data = await res.json();

        if (!data?.ok) {
          forgetCheckout();
          // They actually did pay. Following an explicit resume link means they
          // want that ride; arriving here by browser history (or "Book another
          // ride") does not — leave those with a clean form.
          if (data?.error === "already_booked" && data.booking_number && explicit) {
            window.location.replace(`/track/${data.booking_number}`);
            return;
          }
          if (explicit) setNotice("That payment link has expired. Please enter your trip again.");
          return;
        }

        const p = data.payload ?? {};
        setOutbound(journeyFrom(p.outbound ?? {}));
        if (p.return) {
          setReturnEnabled(true);
          setRet(journeyFrom(p.return));
        }
        setName(p.name ?? "");
        setWhatsapp(p.whatsapp ?? "");
        setEmail(p.email ?? "");
        setNotes(p.notes ?? "");
        setChildSeatOn(!!p.child_seat);
        setPassengers(p.passengers ?? 1);
        setSuitcases(p.suitcases ?? 0);
        setHandLuggage(p.hand_luggage ?? 0);
        setPayment("card");
        if (p.outbound?.scheduled_at) {
          setScheduleMode("later");
          setScheduledAt(toLocalInput(p.outbound.scheduled_at));
        }
        if (p.return?.scheduled_at) setReturnAt(toLocalInput(p.return.scheduled_at));
        setPendingCategory(p.category_id ?? null);
        // Keep it: they may bounce off the payment page more than once.
        rememberCheckout(draftId);
        setNotice(
          explicit
            ? "Payment cancelled — your trip is still here. You can pay again whenever you're ready."
            : "Welcome back — your trip is still here. You can pay whenever you're ready."
        );
      } catch {
        /* a failed restore just means an empty form — not worth an error */
      } finally {
        // Drop ?resume= so a refresh doesn't replay this.
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
  }, []);

  const [minDT, setMinDT] = useState("");
  useEffect(() => {
    const update = () => {
      const d = new Date(Date.now() + 30 * 60000);
      const p = (n: number) => String(n).padStart(2, "0");
      setMinDT(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
    };
    update();
    const t = setInterval(update, 60000); // keep the min fresh on long-open forms
    return () => clearInterval(t);
  }, []);

  // Request tokens so a slow /api/route response for a previous address can't
  // overwrite the distance of a route the user has since changed.
  const outReqId = useRef(0);
  const retReqId = useRef(0);

  // Auto-compute distance for the outbound journey
  useEffect(() => {
    if (allCoords(outbound) && outbound.km == null) {
      const id = ++outReqId.current;
      getRoute(outbound).then((r) => {
        if (r && id === outReqId.current) setOutbound((o) => ({ ...o, km: r.km, min: r.min }));
      });
    }
  }, [outbound]);

  // Auto-compute distance for the return journey
  useEffect(() => {
    if (returnEnabled && allCoords(ret) && ret.km == null) {
      const id = ++retReqId.current;
      getRoute(ret).then((r) => {
        if (r && id === retReqId.current) setRet((o) => ({ ...o, km: r.km, min: r.min }));
      });
    }
  }, [returnEnabled, ret]);

  const toggleReturn = () => {
    if (!returnEnabled) {
      // Pre-fill return as the reverse of the outbound trip
      setRet({
        pickup: outbound.dropoff.address ? outbound.dropoff : empty,
        vias: [],
        dropoff: outbound.pickup.address ? outbound.pickup : empty,
        km: null,
        min: null,
      });
    }
    setReturnEnabled((v) => !v);
  };

  const outAt = scheduleMode === "later" && scheduledAt ? new Date(scheduledAt).toISOString() : null;
  const retAt = returnAt ? new Date(returnAt).toISOString() : null;

  const outReady = outbound.pickup.address.trim() && outbound.dropoff.address.trim() && !!outbound.km;
  // Compare the datetime-local strings directly (fixed-width format sorts
  // chronologically) so we stay pure — no Date.now() during render.
  const outboundStart = scheduleMode === "later" && scheduledAt ? scheduledAt : minDT;
  const returnAfterOutbound = !!returnAt && !!outboundStart && returnAt > outboundStart;
  const retReady =
    !returnEnabled ||
    (!!ret.pickup.address.trim() && !!ret.dropoff.address.trim() && !!ret.km && returnAfterOutbound);
  const timeReady = scheduleMode === "now" || !!scheduledAt;
  const canQuote = outReady && retReady && timeReady;
  const phoneValid = isValidPhone(whatsapp);

  // Card is closed to the public until it is explicitly switched on. Staff
  // taking a phone booking keep it, because they collect that payment
  // themselves — it never goes near SumUp.
  const cardOffered = manual || cardPaymentsEnabled();
  useEffect(() => {
    if (!cardOffered && payment === "card") setPayment("cash");
  }, [cardOffered, payment]);

  const fetchQuotes = useCallback(async () => {
    if (!canQuote) return;
    setLoadingQuotes(true);
    setError(null);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site,
          outbound: priceLeg(outbound, outAt),
          return: returnEnabled ? priceLeg(ret, retAt) : null,
        }),
      });
      const data = await res.json();
      setLoadingQuotes(false);
      if (!data?.ok) {
        setError("Could not load prices. Please try again.");
        return;
      }
      setQuotes(data.quotes as Quote[]);
      setHasReturnQuote(!!data.hasReturn);
      setChildSeatPrice(Number(data.child_seat_price) || 0);
      setSelected((data.quotes as Quote[])[0]?.category_id ?? null);
      setStep(1);
    } catch {
      setLoadingQuotes(false);
      setError("Could not load prices. Please try again.");
    }
  }, [canQuote, site, outbound, ret, returnEnabled, outAt, retAt]);

  // Finish restoring a cancelled checkout: price the trip again, then drop the
  // customer straight back on the details step with their car re-selected.
  useEffect(() => {
    if (pendingCategory && canQuote && quotes.length === 0 && !loadingQuotes) fetchQuotes();
  }, [pendingCategory, canQuote, quotes.length, loadingQuotes, fetchQuotes]);

  useEffect(() => {
    if (!pendingCategory || quotes.length === 0) return;
    if (quotes.some((q) => q.category_id === pendingCategory)) setSelected(pendingCategory);
    setStep(2);
    setPendingCategory(null);
  }, [pendingCategory, quotes]);

  const legPayload = (j: Journey, at: string | null) => ({
    pickup_address: j.pickup.address,
    pickup_lat: j.pickup.lat,
    pickup_lng: j.pickup.lng,
    dropoff_address: j.dropoff.address,
    dropoff_lat: j.dropoff.lat,
    dropoff_lng: j.dropoff.lng,
    via_points: j.vias.map((v) => ({ address: v.address, lat: v.lat, lng: v.lng })),
    distance_km: j.km,
    duration_min: j.min,
    scheduled_at: at,
    route_text: routeText(j),
  });

  const bookingPayload = () => ({
    site,
    name: name.trim(),
    whatsapp: whatsapp.trim(),
    email: email.trim(),
    category_id: selected,
    payment_method: payment,
    notes: notes || null,
    child_seat: childSeatOn,
    passengers,
    suitcases,
    hand_luggage: handLuggage,
    outbound: legPayload(outbound, outAt),
    return: returnEnabled ? legPayload(ret, retAt) : null,
    ...(customFare != null ? { custom_fare: customFare } : {}),
  });

  /**
   * Card: hand off to SumUp Checkout.
   *
   * No booking is created yet — the trip is parked server-side and only becomes
   * a booking once SumUp confirms the payment, so an abandoned checkout leaves
   * nothing behind. The customer comes back to /booking/complete.
   */
  const startCardPayment = async () => {
    if (!selected || !name.trim() || !phoneValid || !emailValid(email)) return;
    setLeaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingPayload()),
      });
      const data = await res.json();
      if (!data?.ok || !data.url) {
        setLeaving(false);
        setError(
          data?.error === "payments_not_configured" || data?.error === "card_disabled"
            ? "Card payments aren't available right now — please choose Cash."
            : "Could not start the payment. Please try again or choose Cash."
        );
        return;
      }
      if (data.draft_id) rememberCheckout(data.draft_id);
      goToCheckout(data.url);
    } catch {
      setLeaving(false);
      setError("Could not start the payment. Please try again or choose Cash.");
    }
  };

  const submit = async () => {
    if (!selected || !name.trim() || !phoneValid || !emailValid(email)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingPayload()),
      });
      const data = await res.json();
      setSubmitting(false);
      if (!data?.ok || !data.outbound?.ok) {
        setError("Booking failed. Please try again.");
        return;
      }
      forgetCheckout();
      setResult({
        outbound: data.outbound.booking_number,
        ret: data.return?.booking_number ?? null,
        // The server's figure wins: it includes any staff price override.
        fare: data.fare ?? (finalTotal || data.outbound.estimated_fare),
      });
    } catch {
      setSubmitting(false);
      setError("Booking failed. Please try again.");
    }
  };

  const selectedQuote = quotes.find((q) => q.category_id === selected);
  const childSeatExtra = childSeatOn && childSeatPrice > 0 ? childSeatPrice : 0;
  const grandTotal = (selectedQuote?.total ?? 0) + childSeatExtra;
  // Custom price only applies in staff/manual mode when a valid amount is entered.
  const customFare =
    manual && customPrice.trim() !== "" && Number.isFinite(Number(customPrice)) && Number(customPrice) >= 0
      ? Number(customPrice)
      : null;
  const finalTotal = customFare ?? grandTotal;

  // Keep passenger/luggage counts within the selected vehicle's capacity
  useEffect(() => {
    if (!selectedQuote) return;
    setPassengers((p) => Math.min(Math.max(p, 1), selectedQuote.capacity));
    setSuitcases((s) => Math.min(s, selectedQuote.suitcases));
    setHandLuggage((h) => Math.min(h, selectedQuote.hand_bags));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <main
      className={
        manual
          ? "w-full"
          : embed
          ? "flex min-h-screen items-start justify-center bg-transparent p-3"
          : "flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/50 to-white p-4"
      }
    >
      <div className="mx-auto w-full max-w-md">
        {!manual && (
          <div className="mb-4 flex items-center gap-2.5 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 shadow-sm shadow-brand-500/30">
              <Car className="h-5 w-5 text-white" strokeWidth={2.3} />
            </div>
            <span className="font-display text-lg font-bold text-ink-950">Book your ride</span>
          </div>
        )}

        <div
          className={
            manual
              ? "overflow-hidden rounded-2xl border border-gray-100 bg-white"
              : "overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/60"
          }
        >
          <div className="px-6 pt-6">
            <Stepper step={step} />
          </div>

          <div className="p-6">
            {result ? (
              <Success result={result} payment={payment} />
            ) : step === 0 ? (
              <motion.div
                key="trip"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                <h2 className="font-display text-xl font-bold text-ink-950">Where to?</h2>

                <JourneyFields journey={outbound} onChange={setOutbound} />

                {outbound.km != null && (
                  <DistanceChip km={outbound.km} min={outbound.min} />
                )}

                {/* When */}
                <div>
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    When
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(
                      [
                        { k: "now", label: "Now", icon: Clock },
                        { k: "later", label: "Schedule", icon: CalendarClock },
                      ] as const
                    ).map((o) => (
                      <button
                        key={o.k}
                        type="button"
                        onClick={() => setScheduleMode(o.k)}
                        className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-medium transition-all ${
                          scheduleMode === o.k
                            ? "border-brand-500 bg-brand-50/60 text-ink-950"
                            : "border-gray-100 text-gray-500 hover:border-gray-200"
                        }`}
                      >
                        <o.icon className="h-4 w-4" /> {o.label}
                      </button>
                    ))}
                  </div>
                  {scheduleMode === "later" && (
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      min={minDT}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="mt-2.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
                    />
                  )}
                </div>

                {/* Return journey toggle */}
                <button
                  type="button"
                  onClick={toggleReturn}
                  className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                    returnEnabled
                      ? "border-brand-500 bg-brand-50/60 text-ink-950"
                      : "border-gray-100 text-gray-600 hover:border-gray-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-brand-500" /> Add return journey?
                  </span>
                  <span
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      returnEnabled ? "bg-brand-500" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        returnEnabled ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>

                {returnEnabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-4 rounded-2xl bg-gray-50 p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Return trip</p>
                    <JourneyFields journey={ret} onChange={setRet} />
                    {ret.km != null && <DistanceChip km={ret.km} min={ret.min} />}
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Return time
                      </span>
                      <input
                        type="datetime-local"
                        value={returnAt}
                        min={minDT}
                        onChange={(e) => setReturnAt(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
                      />
                    </label>
                  </motion.div>
                )}

                {/* Live route map */}
                <MapSection
                  outbound={{ pickup: outbound.pickup, vias: outbound.vias, dropoff: outbound.dropoff }}
                  returnLeg={
                    returnEnabled ? { pickup: ret.pickup, vias: ret.vias, dropoff: ret.dropoff } : null
                  }
                />

                {error && <p className="text-sm text-red-600">{error}</p>}

                {outbound.pickup.address.trim() &&
                  outbound.dropoff.address.trim() &&
                  !allCoords(outbound) && (
                    <p className="text-xs text-gray-500">
                      Pick your addresses from the suggestions so we can calculate the distance &amp; price.
                    </p>
                  )}

                {returnEnabled && !!returnAt && !returnAfterOutbound && (
                  <p className="text-xs text-red-500">Return time must be after the outbound trip.</p>
                )}

                <button
                  disabled={!canQuote || loadingQuotes}
                  onClick={fetchQuotes}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3.5 font-semibold text-white shadow-lg shadow-brand-500/30 transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                >
                  {loadingQuotes ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      See prices <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>
              </motion.div>
            ) : step === 1 ? (
              <motion.div
                key="car"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-3"
              >
                <button
                  onClick={() => setStep(0)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-ink-950"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <h2 className="font-display text-xl font-bold text-ink-950">Choose your ride</h2>
                {hasReturnQuote && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
                    <Repeat className="h-3.5 w-3.5" /> Prices include both trips (there &amp; back)
                  </p>
                )}

                <div className="space-y-2.5">
                  {quotes.map((q, i) => {
                    const Icon = carIcon(q.icon);
                    const active = selected === q.category_id;
                    return (
                      <motion.button
                        key={q.category_id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06 }}
                        onClick={() => setSelected(q.category_id)}
                        className={`flex w-full flex-col gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                          active
                            ? "border-brand-400 bg-brand-50/40 shadow-sm shadow-brand-500/10 ring-1 ring-brand-400"
                            : "border-gray-100 bg-white hover:border-gray-200"
                        }`}
                      >
                        <div className="flex w-full items-center gap-3">
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                              active ? "bg-brand-500 text-white" : "bg-gray-100 text-ink-950"
                            }`}
                          >
                            <Icon className="h-6 w-6" strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-ink-950">{q.name}</span>
                            <p className="truncate text-xs text-gray-500">
                              {hasReturnQuote
                                ? `${money(q.outbound_total)} + ${money(q.return_total)} return`
                                : q.description}
                            </p>
                          </div>
                          <span className="font-display text-lg font-bold text-ink-950">{money(q.total)}</span>
                        </div>
                        <div
                          className={`flex items-center justify-around rounded-xl py-2 ${
                            active ? "bg-white/70" : "bg-gray-50"
                          }`}
                        >
                          <Spec icon={Users} value={q.capacity} label="Seats" active={active} />
                          <span className="h-4 w-px bg-gray-200" />
                          <Spec icon={Luggage} value={q.suitcases} label="Suitcases" active={active} />
                          <span className="h-4 w-px bg-gray-200" />
                          <Spec icon={Backpack} value={q.hand_bags} label="Bags" active={active} />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Live route map */}
                <MapSection
                  outbound={{ pickup: outbound.pickup, vias: outbound.vias, dropoff: outbound.dropoff }}
                  returnLeg={
                    returnEnabled ? { pickup: ret.pickup, vias: ret.vias, dropoff: ret.dropoff } : null
                  }
                />

                <button
                  disabled={!selected}
                  onClick={() => setStep(2)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3.5 font-semibold text-white shadow-lg shadow-brand-500/30 transition-all hover:bg-brand-600 disabled:bg-gray-200"
                >
                  Continue <ArrowRight className="h-5 w-5" />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-ink-950"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <h2 className="font-display text-xl font-bold text-ink-950">Your details</h2>

                <Field icon={User} placeholder="Full name" value={name} onChange={setName} />
                <div>
                  <Field icon={Phone} placeholder="WhatsApp number" value={whatsapp} onChange={setWhatsapp} type="tel" />
                  {whatsapp.trim() && !phoneValid && (
                    <p className="mt-1 pl-1 text-xs text-red-500">Please enter a valid phone number.</p>
                  )}
                </div>
                <div>
                  <Field icon={Mail} placeholder="Email address" value={email} onChange={setEmail} type="email" />
                  {email.trim() && !emailValid(email) && (
                    <p className="mt-1 pl-1 text-xs text-red-500">Please enter a valid email address.</p>
                  )}
                </div>

                {/* Passengers & luggage */}
                <div>
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Passengers &amp; luggage
                  </span>
                  <div className="space-y-2">
                    <Counter
                      icon={Users}
                      label="Passengers"
                      value={passengers}
                      onChange={setPassengers}
                      min={1}
                      max={selectedQuote?.capacity ?? 8}
                    />
                    <Counter
                      icon={Luggage}
                      label="Suitcases"
                      value={suitcases}
                      onChange={setSuitcases}
                      min={0}
                      max={selectedQuote?.suitcases ?? 10}
                    />
                    <Counter
                      icon={Backpack}
                      label="Hand luggage"
                      value={handLuggage}
                      onChange={setHandLuggage}
                      min={0}
                      max={selectedQuote?.hand_bags ?? 10}
                    />
                  </div>
                </div>

                <Field icon={MapPin} placeholder="Notes for driver (optional)" value={notes} onChange={setNotes} />

                {/* Child seat */}
                <button
                  type="button"
                  onClick={() => setChildSeatOn((v) => !v)}
                  aria-pressed={childSeatOn}
                  className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                    childSeatOn
                      ? "border-brand-500 bg-brand-50/60 text-ink-950"
                      : "border-gray-100 text-gray-600 hover:border-gray-200"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      childSeatOn ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300"
                    }`}
                  >
                    {childSeatOn && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className="flex flex-1 items-center gap-2">
                    <Baby className="h-4 w-4 text-brand-500" /> I require a child seat
                  </span>
                  {childSeatPrice > 0 && (
                    <span className="shrink-0 text-xs font-bold text-brand-600">+{money(childSeatPrice)}</span>
                  )}
                </button>

                {/* Payment — last */}
                <div>
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Payment
                  </span>
                  {!cardOffered ? (
                    <div className="flex items-center gap-2.5 rounded-xl border-2 border-brand-500 bg-brand-50/60 py-3 pl-4 text-sm font-medium text-ink-950">
                      <Banknote className="h-5 w-5 text-brand-600" /> Cash to driver
                    </div>
                  ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {(
                      [
                        { key: "cash", label: "Cash", icon: Banknote },
                        { key: "card", label: "Card", icon: CreditCard },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.key}
                        onClick={() => setPayment(p.key)}
                        className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 font-medium transition-all ${
                          payment === p.key
                            ? "border-brand-500 bg-brand-50/60 text-ink-950"
                            : "border-gray-100 text-gray-500 hover:border-gray-200"
                        }`}
                      >
                        <p.icon className="h-5 w-5" /> {p.label}
                      </button>
                    ))}
                  </div>
                  )}
                </div>

                {selectedQuote && (
                  <div className="overflow-hidden rounded-xl border border-brand-200 bg-brand-50">
                    {childSeatExtra > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1 border-b border-brand-200/60 px-4 pt-3 text-xs text-brand-800">
                          <div className="flex items-center justify-between">
                            <span>
                              {selectedQuote.name}
                              {hasReturnQuote ? " · return" : ""}
                            </span>
                            <span>{money(selectedQuote.total)}</span>
                          </div>
                          <div className="flex items-center justify-between pb-1">
                            <span className="flex items-center gap-1">
                              <Baby className="h-3.5 w-3.5" /> Child seat
                            </span>
                            <span>+{money(childSeatExtra)}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <span className="text-sm font-medium text-brand-800">
                        {childSeatExtra > 0 ? "Total" : `${selectedQuote.name}${hasReturnQuote ? " · return" : ""} · total`}
                      </span>
                      <motion.span
                        key={grandTotal}
                        initial={{ scale: 0.86, opacity: 0.5 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 380, damping: 18 }}
                        className="font-display text-xl font-bold text-ink-950"
                      >
                        {money(grandTotal)}
                      </motion.span>
                    </div>
                  </div>
                )}

                {/* Staff-only manual price override (discount / rush pricing) */}
                {manual && (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 p-3">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Custom price (staff only)
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">£</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)}
                        placeholder={`Auto: ${grandTotal.toFixed(2)}`}
                        className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-7 pr-4 text-[15px] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {customFare != null
                        ? `Using custom price: ${money(customFare)} (overrides the calculated fare)`
                        : "Leave empty to use the calculated price. Set a lower price for a discount, or higher for rush hours."}
                    </p>
                  </div>
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}

                {notice && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    {notice}
                  </p>
                )}

                <button
                  disabled={submitting || leaving || !name.trim() || !phoneValid || !emailValid(email)}
                  onClick={payment === "card" && !manual ? startCardPayment : submit}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-4 text-base font-bold text-white shadow-lg shadow-brand-500/30 transition-all hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {submitting || leaving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : payment === "card" && !manual ? (
                    <>
                      <Lock className="h-5 w-5" /> Pay &amp; Book {money(grandTotal)}
                    </>
                  ) : (
                    "Book Ride"
                  )}
                </button>

                {payment === "card" && !manual && (
                  <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-gray-400">
                    <Lock className="h-3 w-3" />
                    You&apos;ll pay securely on SumUp, then come straight back
                  </p>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {!manual && (
          <p className="mt-4 text-center text-xs text-gray-400">Secured booking · Black Falcon 247 Taxi</p>
        )}
      </div>
    </main>
  );
}

function Spec({
  icon: Icon,
  value,
  label,
  active,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  active: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs" title={`${value} ${label.toLowerCase()}`}>
      <Icon
        className={`h-[18px] w-[18px] ${active ? "text-brand-600" : "text-gray-400"}`}
        strokeWidth={2}
      />
      <span className="font-bold text-ink-950">{value}</span>
      <span className="font-medium text-gray-400">{label}</span>
    </span>
  );
}

function MapSection({ outbound, returnLeg }: { outbound: RouteLeg; returnLeg?: RouteLeg | null }) {
  const [open, setOpen] = useState(false);
  if (outbound.pickup.lat == null || outbound.dropoff.lat == null) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
          open
            ? "border-brand-500 bg-brand-50/60 text-ink-950"
            : "border-gray-100 text-gray-600 hover:border-gray-200"
        }`}
      >
        <span className="flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-brand-500" />
          {open ? "Hide map" : "Show map"}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2.5"
        >
          <RouteMap outbound={outbound} returnLeg={returnLeg} />
        </motion.div>
      )}
    </div>
  );
}

const STEPS = ["Location", "Vehicle", "Details"] as const;

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex">
      {STEPS.map((label, i) => {
        const reached = i <= step; // circle filled
        const done = i < step; // step already completed
        return (
          <div key={label} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div
                className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                  i === 0 ? "invisible" : reached ? "bg-brand-500" : "bg-gray-200"
                }`}
              />
              <div
                className={`mx-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors duration-300 ${
                  reached
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-gray-200 bg-white text-gray-400"
                }`}
              >
                {done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </div>
              <div
                className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                  i === STEPS.length - 1 ? "invisible" : done ? "bg-brand-500" : "bg-gray-200"
                }`}
              />
            </div>
            <span
              className={`mt-1.5 text-xs font-medium transition-colors duration-300 ${
                i === step ? "text-brand-600" : reached ? "text-ink-950" : "text-gray-400"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function JourneyFields({ journey, onChange }: { journey: Journey; onChange: (j: Journey) => void }) {
  const setPickup = (p: PlaceValue) => onChange({ ...journey, pickup: p, km: null, min: null });
  const setDropoff = (p: PlaceValue) => onChange({ ...journey, dropoff: p, km: null, min: null });
  const addVia = () => onChange({ ...journey, vias: [...journey.vias, empty], km: null, min: null });
  const setVia = (i: number, p: PlaceValue) =>
    onChange({ ...journey, vias: journey.vias.map((v, idx) => (idx === i ? p : v)), km: null, min: null });
  const removeVia = (i: number) =>
    onChange({ ...journey, vias: journey.vias.filter((_, idx) => idx !== i), km: null, min: null });

  return (
    <div className="space-y-2.5">
      <AddressAutocomplete
        label="Pick-up"
        icon={MapPin}
        iconClass="text-brand-500"
        value={journey.pickup.address}
        placeholder="Enter pick-up address"
        onChange={(a) => setPickup({ address: a, lat: null, lng: null })}
        onSelect={setPickup}
      />

      {journey.vias.map((v, i) => (
        <div key={i} className="relative">
          <AddressAutocomplete
            label={`Via ${i + 1}`}
            icon={CircleDot}
            iconClass="text-gray-400"
            value={v.address}
            placeholder="Stop along the way"
            onChange={(a) => setVia(i, { address: a, lat: null, lng: null })}
            onSelect={(p) => setVia(i, p)}
          />
          <button
            type="button"
            onClick={() => removeVia(i)}
            className="absolute right-2 top-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
            title="Remove stop"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addVia}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <Plus className="h-4 w-4" /> Add stop (Via)
      </button>

      <AddressAutocomplete
        label="Drop-off"
        icon={Navigation}
        iconClass="text-ink-950"
        value={journey.dropoff.address}
        placeholder="Enter destination"
        onChange={(a) => setDropoff({ address: a, lat: null, lng: null })}
        onSelect={setDropoff}
      />
    </div>
  );
}

function DistanceChip({ km, min }: { km: number; min: number | null }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
      <span className="flex items-center gap-1.5">
        <Route className="h-4 w-4 text-brand-500" /> {km} mi
      </span>
      {min != null && (
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-brand-500" /> ~{min} min
        </span>
      )}
    </div>
  );
}

function Field({
  icon: Icon,
  ...props
}: {
  icon: React.ElementType;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
      <input
        type={props.type || "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-11 pr-4 text-[15px] outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
      />
    </div>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
  onChange,
  min,
  max,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300";
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3.5 py-2">
      <span className="flex items-center gap-2 text-sm text-ink-950">
        <Icon className="h-4 w-4 text-gray-400" /> {label}
      </span>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className={btn}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-5 text-center text-sm font-bold text-ink-950">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className={btn}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Success({
  result,
  payment,
}: {
  result: {
    outbound: string;
    ret: string | null;
    fare: number;
  };
  payment: PaymentMethod;
}) {
  return (
    <motion.div
      key="success"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="py-6 text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100"
      >
        <CheckCircle2 className="h-9 w-9 text-green-600" strokeWidth={2.2} />
      </motion.div>
      <h2 className="font-display text-2xl font-bold text-ink-950">
        {result.ret ? "Rides booked!" : "Ride booked!"}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        We&apos;ll assign a driver shortly and message you on WhatsApp.
      </p>
      <div className="mt-5 space-y-2 rounded-2xl bg-gray-50 p-4 text-left">
        <Row label="Outbound no." value={result.outbound} />
        {result.ret && <Row label="Return no." value={result.ret} />}
        <Row label="Total fare" value={money(result.fare)} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Payment</span>
          {/* A paid-by-card confirmation lives on /booking/complete, not here —
              this screen is only reached by a booking that is paid later. */}
          <span className="font-semibold text-ink-950">{payment === "cash" ? "Cash to driver" : "Card"}</span>
        </div>
      </div>
      <a
        href={`/track/${result.outbound}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 font-semibold text-white shadow-lg shadow-brand-500/30 transition-colors hover:bg-brand-600"
      >
        <MapPin className="h-5 w-5" /> Track your ride
      </a>
      <button
        onClick={() => window.location.reload()}
        className="mt-2.5 w-full rounded-xl border border-gray-200 py-3 font-semibold text-ink-950 transition-colors hover:bg-gray-50"
      >
        Book another ride
      </button>
    </motion.div>
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
