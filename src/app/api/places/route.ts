import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { serverMapsKey } from "@/lib/googleKey";

/** Address autocomplete via Google Places API (New), server-side. */
export async function POST(req: Request) {
  if (!rateLimit(`places:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ predictions: [] }, { status: 429 });
  }
  const { input } = await req.json().catch(() => ({ input: "" }));
  if (!input || input.trim().length < 3) return NextResponse.json({ predictions: [] });

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": serverMapsKey(),
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      // Restrict suggestions to the UK only (service area), and bias to it too.
      body: JSON.stringify({ input, includedRegionCodes: ["gb"], regionCode: "gb" }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) console.error("[places] Google autocomplete failed", res.status, data?.error?.message);
    type Suggestion = { placePrediction?: { placeId?: string; text?: { text?: string } } };
    const predictions = ((data.suggestions ?? []) as Suggestion[])
      .map((s) => s.placePrediction)
      .filter((p): p is { placeId: string; text: { text: string } } => !!p?.placeId && !!p.text?.text)
      .map((p) => ({ description: p.text.text, place_id: p.placeId }));
    return NextResponse.json({ predictions });
  } catch {
    return NextResponse.json({ predictions: [] });
  }
}
