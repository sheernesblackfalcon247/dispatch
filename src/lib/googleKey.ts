/**
 * The Google Maps key used for SERVER-side calls — Places API (New) and Routes API.
 *
 * Deliberately separate from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, because the two
 * halves can only be locked down in opposite ways. The browser key is inlined
 * into the page, so anyone can read it; its one real defence is an HTTP
 * referrer restriction naming our domains. This key never leaves the server,
 * where there is no referrer to send — a referrer rule would reject every call
 * we make here, and an IP rule would break the map in the browser. One key
 * cannot carry both, which is why there are two.
 *
 * Falls back to the public key so an instance that has not split its keys yet
 * keeps working unchanged; set GOOGLE_MAPS_API_KEY to stop sharing one.
 *
 * Read per call rather than at import time, so a key set in the hosting
 * dashboard takes effect without a rebuild.
 */
export function serverMapsKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  );
}
