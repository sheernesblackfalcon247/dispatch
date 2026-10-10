import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { serverMapsKey } from "@/lib/googleKey";

type Details = { address: string | null; lat: number | null; lng: number | null };

/**
 * Resolve a place id to a formatted address + coordinates.
 *
 * Places API (New) first, legacy Places as the fallback — the same place ids
 * work in both, so whichever API the key is allowed to use answers.
 */
export async function POST(req: Request) {
  if (!rateLimit(`place-details:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const { place_id } = await req.json().catch(() => ({ place_id: "" }));
  if (!place_id || typeof place_id !== "string") return NextResponse.json({ ok: false });

  const key = serverMapsKey();
  const r = (await detailsNew(place_id, key)) ?? (await detailsLegacy(place_id, key));
  if (!r) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, ...r });
}

async function detailsNew(placeId: string, key: string): Promise<Details | null> {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        // Only these two fields are billed and returned.
        "X-Goog-FieldMask": "formattedAddress,location",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const r = await res.json();
    return {
      address: r.formattedAddress ?? null,
      lat: r.location?.latitude ?? null,
      lng: r.location?.longitude ?? null,
    };
  } catch {
    return null;
  }
}

async function detailsLegacy(placeId: string, key: string): Promise<Details | null> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&fields=formatted_address,geometry&key=${key}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    const r = data.result;
    if (!r) {
      console.error("[place-details] Google refused both Places APIs", data.status, data.error_message);
      return null;
    }
    return {
      address: r.formatted_address ?? null,
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
    };
  } catch {
    return null;
  }
}
