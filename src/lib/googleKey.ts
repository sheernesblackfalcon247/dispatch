/**
 * The Google Maps key — used only on the server, for Places API (New) and the
 * Routes API. It is never sent to the browser: the maps on the page are drawn
 * on OpenStreetMap, and address search and routing go through our own API
 * routes. Lock it down by API (Places API (New), Routes API) with a daily quota
 * cap in Google Cloud.
 *
 * Read per call rather than at import time, so a key set in the hosting
 * dashboard takes effect without a rebuild.
 */
export function serverMapsKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}
