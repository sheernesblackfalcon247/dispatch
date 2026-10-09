/**
 * Server-side Google Routes API helper.
 *
 * Used both by the /api/route endpoint (for the widget's live distance chip)
 * and by the quote/book/payment routes to RE-DERIVE trip distance from
 * coordinates server-side — so the fare can never be under-reported by a
 * client that lies about `distance_km`.
 */
import { serverMapsKey } from "@/lib/googleKey";

export interface Pt {
  lat: number | null | undefined;
  lng: number | null | undefined;
}

export interface LegInput {
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  via_points?: { lat: number | null; lng: number | null }[];
  distance_km?: number | null;
  duration_min?: number | null;
}

const hasCoord = (p?: Pt | null): p is { lat: number; lng: number } =>
  !!p && typeof p.lat === "number" && typeof p.lng === "number";

/**
 * Driving distance (MILES) + duration (min) through optional waypoints. Null on failure.
 * NOTE: the app works in miles (UK). The `km`/`distance_km` field names are kept
 * for compatibility but hold MILES.
 */
export async function googleRouteDistance(
  origin: Pt,
  destination: Pt,
  waypoints: Pt[] = []
): Promise<{ km: number; min: number; polyline: string | null } | null> {
  const key = serverMapsKey();
  if (!key || !hasCoord(origin) || !hasCoord(destination)) return null;

  const at = (p: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: at(origin),
        destination: at(destination),
        intermediates: waypoints.filter(hasCoord).map(at),
        travelMode: "DRIVE",
        // Same answer the old Directions API gave by default: the route and
        // distance don't move with live traffic, so neither does the fare.
        routingPreference: "TRAFFIC_UNAWARE",
        units: "IMPERIAL",
      }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[route] Google Routes API failed", res.status, data?.error?.message);
      return null;
    }
    const route = data.routes?.[0] as
      | { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }
      | undefined;
    if (!route?.distanceMeters) return null;
    // Duration comes back as a string of seconds, e.g. "1834s".
    const secs = parseFloat(route.duration ?? "0") || 0;
    return {
      km: Number((route.distanceMeters / 1609.344).toFixed(2)),
      min: Math.round(secs / 60),
      polyline: route.polyline?.encodedPolyline ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Trusted distance/duration for a booking leg.
 *
 * Distance is ALWAYS re-derived from coordinates via Google. The client's own
 * `distance_km` is only ever honoured when `trustClient` is set, which is
 * reserved for a signed-in staff member typing a phone booking by hand.
 *
 * For anything public this returns null rather than falling back, and the
 * caller refuses the request. That is deliberate: a request that simply omits
 * its coordinates used to be priced off `distance_km: 0`, turning a £257
 * airport run into £15. Refusing to price is the only safe failure here.
 */
export async function resolveLegDistance(
  leg: LegInput,
  opts: { trustClient?: boolean } = {}
): Promise<{ distance_km: number; duration_min: number } | null> {
  const origin: Pt = { lat: leg.pickup_lat, lng: leg.pickup_lng };
  const destination: Pt = { lat: leg.dropoff_lat, lng: leg.dropoff_lng };
  const waypoints: Pt[] = (leg.via_points ?? []).map((v) => ({ lat: v.lat, lng: v.lng }));

  if (hasCoord(origin) && hasCoord(destination)) {
    const r = await googleRouteDistance(origin, destination, waypoints);
    if (r) return { distance_km: r.km, duration_min: r.min };
  }

  // No coordinates, or Google could not route them.
  if (!opts.trustClient) return null;

  return {
    distance_km: Number(leg.distance_km) || 0,
    duration_min: Number(leg.duration_min) || 0,
  };
}
