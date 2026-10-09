"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import { MapPin, Navigation } from "lucide-react";
import { useGoogleMaps } from "@/lib/useGoogleMaps";
import { fetchRoutePath } from "@/lib/polyline";
import type { Booking } from "@/lib/types";

declare global {
  interface Window {
    google?: any;
  }
}

interface Props {
  selectedJob: Booking | null;
}

export default function DriverMap({ selectedJob }: Props) {
  const { isLoaded, hasKey } = useGoogleMaps();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeRef = useRef<any>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!isLoaded || !mapEl.current || !window.google?.maps?.Map) return;
    const reqId = ++reqRef.current;
    try {
      if (!mapRef.current) {
        mapRef.current = new window.google.maps.Map(mapEl.current, {
          center: { lat: 51.5074, lng: -0.1278 },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        });
      }

      // Clear previous markers + route
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (routeRef.current) {
        routeRef.current.setMap(null);
        routeRef.current = null;
      }
      if (!selectedJob) return;

      const bounds = new window.google.maps.LatLngBounds();
      const addMarker = (lat: number, lng: number, color: string, label: string, glyph?: string) => {
        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map: mapRef.current,
          title: label,
          label: glyph ? { text: glyph, color: "#fff", fontSize: "10px", fontWeight: "700" } : undefined,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: glyph ? 10 : 9,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 3,
          },
        });
        markersRef.current.push(marker);
        bounds.extend({ lat, lng });
      };

      const vias = (selectedJob.via_points ?? []).filter(
        (v: any) => v?.lat != null && v?.lng != null
      );
      const hasPickup = selectedJob.pickup_lat != null && selectedJob.pickup_lng != null;
      const hasDropoff = selectedJob.dropoff_lat != null && selectedJob.dropoff_lng != null;

      if (hasPickup) addMarker(selectedJob.pickup_lat!, selectedJob.pickup_lng!, "#16a34a", "Pickup", "A");
      vias.forEach((v: any, i: number) =>
        addMarker(v.lat, v.lng, "#6366f1", v.address ?? `Via ${i + 1}`, String(i + 1))
      );
      if (hasDropoff)
        addMarker(selectedJob.dropoff_lat!, selectedJob.dropoff_lng!, "#0b0b0f", "Drop-off", "B");

      // Draw the actual driving route through any via points
      // (from our server's Routes API call — the browser Directions service is
      // a legacy API that new Google projects can't use)
      if (hasPickup && hasDropoff) {
        fetchRoutePath(
          { lat: selectedJob.pickup_lat!, lng: selectedJob.pickup_lng! },
          { lat: selectedJob.dropoff_lat!, lng: selectedJob.dropoff_lng! },
          vias.map((v: any) => ({ lat: v.lat, lng: v.lng }))
        ).then((path) => {
          // Ignore if the selection changed while this was in flight
          if (reqId !== reqRef.current || !path || !mapRef.current) return;
          if (routeRef.current) routeRef.current.setMap(null);
          routeRef.current = new window.google.maps.Polyline({
            map: mapRef.current,
            path,
            strokeColor: "#f5b301",
            strokeWeight: 5,
            strokeOpacity: 0.9,
          });
        });
      }

      if (markersRef.current.length === 1) {
        mapRef.current.setCenter(bounds.getCenter());
        mapRef.current.setZoom(14);
      } else if (markersRef.current.length > 1) {
        mapRef.current.fitBounds(bounds, 80);
      }
    } catch (e) {
      console.error("Map render failed:", e);
    }
  }, [isLoaded, selectedJob]);

  if (hasKey) {
    return <div ref={mapEl} className="h-full w-full rounded-2xl" />;
  }

  // Placeholder when no Google Maps key is configured
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gradient-to-br from-slate-50 to-brand-50/40 text-center">
      {selectedJob ? (
        <div className="max-w-xs space-y-3 px-6">
          <div className="flex items-start gap-2 text-left text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            <span className="text-ink-950">{selectedJob.pickup_address}</span>
          </div>
          <div className="flex items-start gap-2 text-left text-sm">
            <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-ink-950" />
            <span className="text-gray-600">{selectedJob.dropoff_address}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400">Select a job to see its route</p>
      )}
      <p className="mt-4 rounded-full bg-white/80 px-3 py-1.5 text-xs text-gray-400">
        Add a Google Maps key for the live map
      </p>
    </div>
  );
}
