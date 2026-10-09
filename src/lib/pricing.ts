import { callRpc } from "@/lib/supabaseRest";
import { resolveLegDistance, type LegInput } from "@/lib/googleRoute";

/**
 * Server-side price for a whole trip.
 *
 * The only number SumUp is ever asked to charge comes from here — distance is
 * re-derived from coordinates and the fare from the pricing RPC, so a client
 * that edits its own payload cannot lower what it pays.
 */

export interface PriceableLeg extends LegInput {
  route_text?: string;
  scheduled_at?: string | null;
}

interface QuoteRow {
  category_id: string;
  fare: { total: number };
}
interface QuoteResp {
  ok: boolean;
  quotes: QuoteRow[];
  child_seat_price?: number;
}

async function legTotal(
  apiKey: string,
  leg: PriceableLeg,
  categoryId: string,
  trustClient: boolean
): Promise<{ total: number; childSeat: number } | null> {
  // No coordinates, no price. Never fall back to a client-supplied distance for
  // a public quote — that is the whole pricing model handed to the caller.
  const resolved = await resolveLegDistance(leg, { trustClient });
  if (!resolved) return null;
  const { distance_km, duration_min } = resolved;
  const { data } = await callRpc<QuoteResp>("quote_fares", {
    p_api_key: apiKey,
    p_distance_km: distance_km,
    p_duration_min: duration_min,
    p_route_text: leg.route_text ?? "",
    ...(leg.scheduled_at ? { p_at: leg.scheduled_at } : {}),
  });
  if (!data?.ok) return null;
  const q = data.quotes.find((r) => r.category_id === categoryId);
  if (!q) return null;
  return { total: q.fare.total, childSeat: Number(data.child_seat_price) || 0 };
}

/** Whole-trip total in pounds (outbound + return + child seat), or null if it can't be priced. */
export async function priceTrip(
  apiKey: string,
  trip: { category_id: string; child_seat?: boolean; outbound: PriceableLeg; return?: PriceableLeg | null },
  opts: { trustClient?: boolean } = {}
): Promise<number | null> {
  const trust = !!opts.trustClient;
  const out = await legTotal(apiKey, trip.outbound, trip.category_id, trust);
  if (!out) return null;

  let total = out.total;
  if (trip.return) {
    const ret = await legTotal(apiKey, trip.return, trip.category_id, trust);
    if (!ret) return null;
    total += ret.total;
  }
  if (trip.child_seat) total += out.childSeat;

  return Math.round(total * 100) / 100;
}
