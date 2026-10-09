import { NextResponse } from "next/server";
import { googleRouteDistance, type Pt } from "@/lib/googleRoute";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/** Driving distance + duration (and the route line) through optional via waypoints, via the Google Routes API. */
export async function POST(req: Request) {
  if (!rateLimit(`route:${clientIp(req)}`, 40, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const b = await req.json().catch(() => ({}));
  const o: Pt = b.origin;
  const d: Pt = b.destination;
  const waypoints: Pt[] = Array.isArray(b.waypoints) ? b.waypoints : [];
  if (!o?.lat || !d?.lat) return NextResponse.json({ ok: false });

  const r = await googleRouteDistance(o, d, waypoints);
  if (!r) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, km: r.km, min: r.min, polyline: r.polyline });
}
