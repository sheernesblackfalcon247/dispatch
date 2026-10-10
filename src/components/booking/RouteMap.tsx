"use client";

import { useEffect, useRef } from "react";
import { MapPin, Navigation, Loader2 } from "lucide-react";
import type { Map as LeafletMap, Layer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLeaflet, createMap, dotMarker } from "@/lib/leafletMap";
import { fetchRoutePath } from "@/lib/polyline";
import type { PlaceValue } from "@/components/booking/AddressAutocomplete";

export interface RouteLeg {
  pickup: PlaceValue;
  vias: PlaceValue[];
  dropoff: PlaceValue;
}

interface Props {
  outbound: RouteLeg;
  returnLeg?: RouteLeg | null;
}

const OUTBOUND_COLOR = "#16a34a"; // green — outbound (there)
const RETURN_COLOR = "#f5b301"; // amber — return (back)

const hasCoords = (p: PlaceValue) => p.lat != null && p.lng != null;
const legReady = (l: RouteLeg | null | undefined) => !!l && hasCoords(l.pickup) && hasCoords(l.dropoff);

export default function RouteMap({ outbound, returnLeg }: Props) {
  const { L, error } = useLeaflet();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Layer[]>([]);

  const showReturn = legReady(returnLeg);

  // Tear the map down with the component.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!L || !mapEl.current) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let stale = false;

    try {
      if (!mapRef.current) mapRef.current = createMap(L, mapEl.current);
      const map = mapRef.current;

      // Reset previous overlays
      layersRef.current.forEach((l) => l.remove());
      layersRef.current = [];
      const add = (layer: Layer) => {
        layer.addTo(map);
        layersRef.current.push(layer);
      };

      if (!legReady(outbound)) return;

      // Bounds spanning every point of both legs
      const points: [number, number][] = [];
      const extend = (l: RouteLeg) => {
        points.push([l.pickup.lat!, l.pickup.lng!]);
        l.vias.filter(hasCoords).forEach((v) => points.push([v.lat!, v.lng!]));
        points.push([l.dropoff.lat!, l.dropoff.lng!]);
      };
      extend(outbound);
      if (showReturn && returnLeg) extend(returnLeg);

      const frame = () => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize();
        mapRef.current.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
      };
      frame();
      // The map often sits in a panel that is still animating open.
      [80, 250, 600].forEach((ms) => timers.push(setTimeout(frame, ms)));

      // Draw a route's actual path as polished polylines
      const drawPath = (path: { lat: number; lng: number }[], color: string, dashed: boolean) => {
        const latlngs = path.map((p) => [p.lat, p.lng] as [number, number]);
        if (dashed) {
          // Rounded dots — reads as "return" and lets the outbound show between dots
          add(L.polyline(latlngs, { color, weight: 5, opacity: 1, dashArray: "1 12", lineCap: "round" }));
        } else {
          // White casing (halo) + solid colour on top for depth
          add(L.polyline(latlngs, { color: "#ffffff", weight: 9, opacity: 0.95 }));
          add(L.polyline(latlngs, { color, weight: 5, opacity: 1 }));
        }
      };

      // The route comes from our own server (Google Routes API), so the page
      // never needs a Google key.
      const drawLeg = async (leg: RouteLeg, color: string, dashed: boolean) => {
        const path = await fetchRoutePath(
          { lat: leg.pickup.lat!, lng: leg.pickup.lng! },
          { lat: leg.dropoff.lat!, lng: leg.dropoff.lng! },
          leg.vias.filter(hasCoords).map((v) => ({ lat: v.lat!, lng: v.lng! }))
        );
        // The trip changed while we were waiting — a newer run draws instead.
        if (path && !stale) drawPath(path, color, dashed);
      };

      drawLeg(outbound, OUTBOUND_COLOR, false);
      if (showReturn && returnLeg) drawLeg(returnLeg, RETURN_COLOR, true);

      // Markers: pickup (green), vias (gray), dropoff (dark). Reverse trip reuses these two ends.
      add(dotMarker(L, outbound.pickup.lat!, outbound.pickup.lng!, OUTBOUND_COLOR, "Pick-up", undefined, 300));
      outbound.vias
        .filter(hasCoords)
        .forEach((v, i) => add(dotMarker(L, v.lat!, v.lng!, "#9ca3af", `Stop ${i + 1}`, undefined, 100)));
      add(dotMarker(L, outbound.dropoff.lat!, outbound.dropoff.lng!, "#0b0b0f", "Drop-off", undefined, 200));
    } catch (e) {
      console.error("Route map render failed:", e);
    }

    return () => {
      stale = true;
      timers.forEach(clearTimeout);
    };
  }, [L, outbound, returnLeg, showReturn]);

  // Fallback when the map library could not load
  if (error) {
    return (
      <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
          <span className="text-ink-950">{outbound.pickup.address || "Pick-up"}</span>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-ink-950" />
          <span className="text-gray-600">{outbound.dropoff.address || "Drop-off"}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative z-0 h-56 w-full overflow-hidden rounded-2xl border border-gray-100 sm:h-64">
        <div ref={mapEl} className="h-full w-full" />
        {!L && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
          </div>
        )}
      </div>

      {/* Legend — only meaningful when a return trip is shown */}
      {showReturn && (
        <div className="mt-2.5 flex items-center gap-4 px-1 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-6 rounded-full" style={{ backgroundColor: OUTBOUND_COLOR }} />
            Outbound (there)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-6"
              style={{
                backgroundImage: `radial-gradient(circle, ${RETURN_COLOR} 42%, transparent 44%)`,
                backgroundSize: "7px 7px",
                backgroundRepeat: "repeat-x",
                backgroundPosition: "center",
              }}
            />
            Return (back)
          </span>
        </div>
      )}
    </div>
  );
}
