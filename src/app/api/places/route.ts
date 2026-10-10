import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { serverMapsKey } from "@/lib/googleKey";

type Prediction = { description: string; place_id: string };

/**
 * Address autocomplete, server-side, restricted to the UK (service area).
 *
 * Tries Places API (New) first. A key whose Google project only has the legacy
 * Places API (projects set up before March 2025) is refused there, so fall back
 * to the legacy endpoint — whichever one the key is allowed to use answers.
 */
export async function POST(req: Request) {
  if (!rateLimit(`places:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ predictions: [] }, { status: 429 });
  }
  const { input } = await req.json().catch(() => ({ input: "" }));
  if (!input || typeof input !== "string" || input.trim().length < 3) {
    return NextResponse.json({ predictions: [] });
  }

  const key = serverMapsKey();
  const predictions = (await autocompleteNew(input, key)) ?? (await autocompleteLegacy(input, key)) ?? [];
  return NextResponse.json({ predictions });
}

/** Places API (New). Null when this key may not use it. */
async function autocompleteNew(input: string, key: string): Promise<Prediction[] | null> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({ input, includedRegionCodes: ["gb"], regionCode: "gb" }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) return null;
    type Suggestion = { placePrediction?: { placeId?: string; text?: { text?: string } } };
    return ((data.suggestions ?? []) as Suggestion[])
      .map((s) => s.placePrediction)
      .filter((p): p is { placeId: string; text: { text: string } } => !!p?.placeId && !!p.text?.text)
      .map((p) => ({ description: p.text.text, place_id: p.placeId }));
  } catch {
    return null;
  }
}

/** Legacy Places API. Null when this key may not use it either. */
async function autocompleteLegacy(input: string, key: string): Promise<Prediction[] | null> {
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
    input
  )}&components=country:gb&region=gb&key=${key}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[places] Google refused both Places APIs", data.status, data.error_message);
      return null;
    }
    return (data.predictions ?? []).map((p: { description: string; place_id: string }) => ({
      description: p.description,
      place_id: p.place_id,
    }));
  } catch {
    return null;
  }
}
