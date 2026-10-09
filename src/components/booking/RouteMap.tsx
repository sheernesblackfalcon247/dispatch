"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import { MapPin, Navigation, Loader2 } from "lucide-react";
import { useGoogleMaps } from "@/lib/useGoogleMaps";
import { fetchRoutePath } from "@/lib/polyline";
import type { PlaceValue } from "@/components/booking/AddressAutocomplete";

declare global {
  interface Window {
    google?: any;
  }
}

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
  const { isLoaded, hasKey, error } = useGoogleMaps();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const linesRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);

  const showReturn = legReady(returnLeg);

  useEffect(() => {
    if (!isLoaded || !mapEl.current || !window.google?.maps?.Map) return;
    const g = window.google.maps;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let stale = false;

    try {
      if (!mapRef.current) {
        mapRef.current = new g.Map(mapEl.current, {
          center: { lat: 51.5074, lng: -0.1278 },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        });
      }

      // Reset previous overlays
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      linesRef.current.forEach((l) => l.setMap(null));
      linesRef.current = [];

      if (!legReady(outbound)) return;

      const addMarker = (lat: number, lng: number, color: string, label: string, z: number) => {
        markersRef.current.push(
          new g.Marker({
            position: { lat, lng },
            map: mapRef.current,
            title: label,
            zIndex: z,
            icon: {
              path: g.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 3,
            },
          })
        );
      };

      // Bounds spanning every point of both legs
      const bounds = new g.LatLngBounds();
      const extend = (l: RouteLeg) => {
        bounds.extend({ lat: l.pickup.lat, lng: l.pickup.lng });
        l.vias.filter(hasCoords).forEach((v) => bounds.extend({ lat: v.lat, lng: v.lng }));
        bounds.extend({ lat: l.dropoff.lat, lng: l.dropoff.lng });
      };
      extend(outbound);
      if (showReturn && returnLeg) extend(returnLeg);

      const frame = () => {
        if (!mapRef.current) return;
        g.event.trigger(mapRef.current, "resize");
        mapRef.current.fitBounds(bounds, 48);
      };
      frame();
      [80, 250, 600].forEach((ms) => timers.push(setTimeout(frame, ms)));

      const line = (opts: any) =>
        linesRef.current.push(new g.Polyline({ map: mapRef.current, ...opts }));

      // Draw a route's actual path as polished polylines
      const drawPath = (path: any[], color: string, dashed: boolean) => {
        if (dashed) {
          // Rounded dots — reads as "return" and lets the outbound show between dots
          line({
            path,
            strokeOpacity: 0,
            zIndex: 5,
            icons: [
              {
                icon: {
                  path: g.SymbolPath.CIRCLE,
                  scale: 2.6,
                  fillColor: color,
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 1.2,
                },
                offset: "0",
                repeat: "16px",
              },
            ],
          });
        } else {
          // White casing (halo) + solid colour on top for depth
          line({ path, strokeColor: "#ffffff", strokeOpacity: 0.95, strokeWeight: 9, zIndex: 1 });
          line({ path, strokeColor: color, strokeOpacity: 1, strokeWeight: 5, zIndex: 3 });
        }
      };

      // The route comes from our own server (Google Routes API) — the browser
      // Directions service is a legacy API that new Google projects can't use.
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
      addMarker(outbound.pickup.lat!, outbound.pickup.lng!, OUTBOUND_COLOR, "Pick-up", 3);
      outbound.vias.filter(hasCoords).forEach((v, i) => addMarker(v.lat!, v.lng!, "#9ca3af", `Stop ${i + 1}`, 1));
      addMarker(outbound.dropoff.lat!, outbound.dropoff.lng!, "#0b0b0f", "Drop-off", 2);
    } catch (e) {
      console.error("Route map render failed:", e);
    }

    return () => {
      stale = true;
      timers.forEach(clearTimeout);
    };
  }, [isLoaded, outbound, returnLeg, showReturn]);

  // Fallback when no key / load failed
  if (!hasKey || error) {
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
      <div className="relative h-56 w-full overflow-hidden rounded-2xl border border-gray-100 sm:h-64">
        <div ref={mapEl} className="h-full w-full" />
        {!isLoaded && (
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
