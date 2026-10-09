import { randomUUID } from "crypto";
import { callRpc } from "@/lib/supabaseRest";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLegDistance, type LegInput } from "@/lib/googleRoute";
import { isValidPhone } from "@/lib/format";
import { sendEmail, emailEnabled } from "@/lib/email";
import { sendSms, smsEnabled } from "@/lib/sms";
import { customerConfirmationEmail, staffAlertEmail, type BookingEmailData } from "@/lib/emailTemplates";
import { staffAlertRecipients } from "@/lib/notifyStaff";

/**
 * The one place a booking is written and announced.
 *
 * Two routes need this and they must never drift: /api/book for cash, and
 * /api/payment/complete for card (where the booking is only created once SumUp
 * confirms the money). Keeping the RPC call, the fare rules and the
 * email/SMS/log side effects here means a change lands in both at once.
 */

export interface Leg extends LegInput {
  pickup_address: string;
  dropoff_address: string;
  via_points?: { address: string; lat: number | null; lng: number | null }[];
  scheduled_at?: string | null;
  route_text?: string;
}

export interface BookingInput {
  site?: string;
  name: string;
  whatsapp: string;
  email: string;
  category_id: string;
  payment_method?: "cash" | "card";
  notes?: string | null;
  child_seat?: boolean;
  passengers?: number;
  suitcases?: number;
  hand_luggage?: number;
  outbound: Leg;
  return?: Leg | null;
}

export interface LegResult {
  ok: boolean;
  error?: string;
  booking_id?: string;
  booking_number?: string;
  estimated_fare?: number;
  website?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Everything a booking needs before we spend money on Google/SumUp calls. */
export function validateBookingInput(b: Partial<BookingInput>): string | null {
  if (!b?.name?.trim() || !b?.whatsapp?.trim() || !b?.category_id || !b?.outbound) return "missing_fields";
  if (!b.email?.trim() || !EMAIL_RE.test(b.email.trim())) return "invalid_email";
  if (!isValidPhone(b.whatsapp)) return "invalid_phone";
  return null;
}

export interface CreatedTrip {
  outbound: LegResult;
  return: LegResult | null;
  tripGroupId: string | null;
  /** Sum of the per-leg fares the RPC computed, in pounds. */
  total: number;
}

/**
 * Write the booking (both legs for a return trip) through the create_booking RPC.
 * Distance is always recomputed server-side from coordinates, so a client that
 * under-reports distance_km cannot lower its own fare.
 */
export async function createTrip(
  b: BookingInput,
  apiKey: string,
  /**
   * `trustClient` honours a caller-supplied distance when there are no
   * coordinates. ONLY ever true for a signed-in staff member taking a booking
   * over the phone — for the public it would let anyone name their own fare.
   */
  opts: { trustClient?: boolean } = {}
): Promise<CreatedTrip | { error: LegResult }> {
  const hasReturn = !!b.return;
  const tripGroupId = hasReturn ? randomUUID() : null;

  const createLeg = async (leg: Leg, isReturn: boolean): Promise<LegResult | null> => {
    const resolved = await resolveLegDistance(leg, { trustClient: opts.trustClient });
    if (!resolved) return { ok: false, error: "no_route" };
    const { distance_km, duration_min } = resolved;
    const { data } = await callRpc<LegResult>("create_booking", {
      p_api_key: apiKey,
      p_customer_name: b.name,
      p_whatsapp: b.whatsapp,
      p_pickup_address: leg.pickup_address,
      p_dropoff_address: leg.dropoff_address,
      p_category_id: b.category_id,
      p_pickup_lat: leg.pickup_lat ?? null,
      p_pickup_lng: leg.pickup_lng ?? null,
      p_dropoff_lat: leg.dropoff_lat ?? null,
      p_dropoff_lng: leg.dropoff_lng ?? null,
      p_distance_km: distance_km,
      p_duration_min: duration_min,
      p_payment_method: b.payment_method ?? "cash",
      p_notes: b.notes ?? null,
      p_scheduled_at: leg.scheduled_at ?? null,
      p_via_points: leg.via_points ?? [],
      p_trip_group_id: tripGroupId,
      p_is_return: isReturn,
      p_route_text: leg.route_text ?? null,
      p_email: b.email ?? null,
      p_child_seat: b.child_seat ? "1" : null,
      p_passengers: b.passengers ?? 1,
      p_suitcases: b.suitcases ?? 0,
      p_hand_luggage: b.hand_luggage ?? 0,
    });
    return data;
  };

  const outbound = await createLeg(b.outbound, false);
  if (!outbound?.ok) return { error: outbound ?? { ok: false, error: "no_response" } };

  const ret = hasReturn ? await createLeg(b.return as Leg, true) : null;

  return {
    outbound,
    return: ret,
    tripGroupId,
    total: (outbound.estimated_fare ?? 0) + (ret?.ok ? ret.estimated_fare ?? 0 : 0),
  };
}

export interface NotifyOptions {
  input: BookingInput;
  trip: CreatedTrip;
  /** What the customer is told they owe — may differ from the per-leg sum. */
  totalFare: number;
  paid: boolean;
  origin: string;
}

/**
 * Confirmation SMS + customer email + staff alert + activity log.
 * All best-effort: the booking already exists, so none of this may throw.
 */
export async function notifyBooking(opts: NotifyOptions): Promise<void> {
  const { input: b, trip, totalFare, paid, origin } = opts;
  const out = b.outbound;
  const outbound = trip.outbound;

  if ((await smsEnabled()) && b.whatsapp) {
    try {
      const when = out.scheduled_at
        ? new Date(out.scheduled_at).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "ASAP";
      const site = outbound.website || "Your taxi";
      await sendSms(
        b.whatsapp,
        `${site}: Booking confirmed. Ref ${outbound.booking_number}. ` +
          `${out.pickup_address} to ${out.dropoff_address}. ${when}. ` +
          `Total £${totalFare.toFixed(2)} (${b.payment_method ?? "cash"}). ` +
          `Track your ride: ${origin}/track/${outbound.booking_number}`
      );
    } catch {
      /* SMS is best-effort — booking already succeeded */
    }
  }

  if (await emailEnabled()) {
    try {
      const admin = createAdminClient();
      const [{ data: cat }, staffEmails] = await Promise.all([
        admin.from("vehicle_categories").select("name").eq("id", b.category_id).maybeSingle(),
        staffAlertRecipients(),
      ]);

      const data: BookingEmailData = {
        bookingNumber: outbound.booking_number ?? "",
        customerName: b.name,
        customerWhatsapp: b.whatsapp,
        customerEmail: b.email,
        pickup: out.pickup_address,
        vias: (out.via_points ?? []).map((v) => v.address).filter(Boolean),
        dropoff: out.dropoff_address,
        carName: (cat as { name?: string } | null)?.name ?? null,
        distanceKm: out.distance_km ?? null,
        fare: totalFare,
        paymentMethod: (b.payment_method ?? "cash") as "cash" | "card",
        paid,
        scheduledAt: out.scheduled_at ?? null,
        isReturn: false,
        returnBookingNumber: trip.return?.booking_number ?? null,
        trackUrl: `${origin}/track/${outbound.booking_number}`,
        installUrl: `${origin}/install`,
        siteName: outbound.website,
      };

      const customer = customerConfirmationEmail(data);
      const staffMail = staffAlertEmail(data, `${origin}/dispatch`);
      await Promise.all([
        b.email ? sendEmail({ to: b.email, subject: customer.subject, html: customer.html }) : null,
        staffEmails.length
          ? sendEmail({ to: staffEmails, subject: staffMail.subject, html: staffMail.html })
          : null,
      ]);
    } catch {
      /* email is best-effort — booking already succeeded */
    }
  }

  try {
    const admin = createAdminClient();
    await admin.from("activity_logs").insert({
      action: "booking_created",
      description: `New booking ${outbound.booking_number} — ${b.name}`,
      metadata: { fare: totalFare, payment: b.payment_method ?? "cash", paid },
    });
  } catch {
    /* ignore logging errors */
  }
}
