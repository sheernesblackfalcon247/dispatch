import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { serverMapsKey } from "@/lib/googleKey";

/** Resolve a place id to a formatted address + coordinates (Places API (New)). */
export async function POST(req: Request) {
  if (!rateLimit(`place-details:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const { place_id } = await req.json().catch(() => ({ place_id: "" }));
  if (!place_id || typeof place_id !== "string") return NextResponse.json({ ok: false });

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(place_id)}`, {
      headers: {
        "X-Goog-Api-Key": serverMapsKey(),
        // Only these two fields are billed and returned.
        "X-Goog-FieldMask": "formattedAddress,location",
      },
      cache: "no-store",
    });
    const r = await res.json();
    if (!res.ok) {
      console.error("[place-details] Google lookup failed", res.status, r?.error?.message);
      return NextResponse.json({ ok: false });
    }
    return NextResponse.json({
      ok: true,
      address: r.formattedAddress ?? null,
      lat: r.location?.latitude ?? null,
      lng: r.location?.longitude ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
