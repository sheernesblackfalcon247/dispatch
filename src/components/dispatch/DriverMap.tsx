"use client";

import { useEffect, useRef } from "react";
import { MapPin, Navigation } from "lucide-react";
import type { Map as LeafletMap, Layer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLeaflet, createMap, dotMarker } from "@/lib/leafletMap";
import { fetchRoutePath } from "@/lib/polyline";
import type { Booking } from "@/lib/types";

interface Props {
  selectedJob: Booking | null;
}

export default function DriverMap({ selectedJob }: Props) {
  const { L, error } = useLeaflet();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Layer[]>([]);
  const routeRef = useRef<Layer | null>(null);
  const reqRef = useRef(0);

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
    const reqId = ++reqRef.current;
    try {
      if (!mapRef.current) mapRef.current = createMap(L, mapEl.current, { zoom: 12, scrollWheelZoom: true });
      const map = mapRef.current;
      map.invalidateSize();

      // Clear previous markers + route
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (routeRef.current) {
        routeRef.current.remove();
        routeRef.current = null;
      }
      if (!selectedJob) return;

      const points: [number, number][] = [];
      const addMarker = (lat: number, lng: number, color: string, label: string, glyph?: string) => {
        const marker = dotMarker(L, lat, lng, color, label, glyph).addTo(map);
        markersRef.current.push(marker);
        points.push([lat, lng]);
      };

      const vias = (selectedJob.via_points ?? []).filter(
        (v): v is typeof v & { lat: number; lng: number } => v?.lat != null && v?.lng != null
      );
      const hasPickup = selectedJob.pickup_lat != null && selectedJob.pickup_lng != null;
      const hasDropoff = selectedJob.dropoff_lat != null && selectedJob.dropoff_lng != null;

      if (hasPickup) addMarker(selectedJob.pickup_lat!, selectedJob.pickup_lng!, "#16a34a", "Pickup", "A");
      vias.forEach((v, i) => addMarker(v.lat, v.lng, "#6366f1", v.address ?? `Via ${i + 1}`, String(i + 1)));
      if (hasDropoff)
        addMarker(selectedJob.dropoff_lat!, selectedJob.dropoff_lng!, "#0b0b0f", "Drop-off", "B");

      // Draw the actual driving route through any via points (from our server's
      // Routes API call, so the page never needs a Google key)
      if (hasPickup && hasDropoff) {
        fetchRoutePath(
          { lat: selectedJob.pickup_lat!, lng: selectedJob.pickup_lng! },
          { lat: selectedJob.dropoff_lat!, lng: selectedJob.dropoff_lng! },
          vias.map((v) => ({ lat: v.lat, lng: v.lng }))
        ).then((path) => {
          // Ignore if the selection changed while this was in flight
          if (reqId !== reqRef.current || !path || !mapRef.current) return;
          if (routeRef.current) routeRef.current.remove();
          routeRef.current = L.polyline(
            path.map((p) => [p.lat, p.lng] as [number, number]),
            { color: "#f5b301", weight: 5, opacity: 0.9 }
          ).addTo(mapRef.current);
        });
      }

      if (points.length === 1) {
        map.setView(points[0], 14);
      } else if (points.length > 1) {
        map.fitBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: 15 });
      }
    } catch (e) {
      console.error("Map render failed:", e);
    }
  }, [L, selectedJob]);

  if (!error) {
    return <div ref={mapEl} className="relative z-0 h-full w-full overflow-hidden rounded-2xl" />;
  }

  // Placeholder when the map library could not load
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
      <p className="mt-4 rounded-full bg-white/80 px-3 py-1.5 text-xs text-gray-400">The map could not be loaded</p>
    </div>
  );
}
