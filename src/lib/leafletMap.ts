"use client";

/**
 * Map display without a Google key in the browser.
 *
 * The maps are drawn with Leaflet on OpenStreetMap tiles, which need no key at
 * all. Everything that does need Google — address search, place lookup and the
 * driving route — goes through our own server, so the Google key never reaches
 * the page.
 */
import { useEffect, useState } from "react";
import type * as Leaflet from "leaflet";

export type L = typeof Leaflet;

let loading: Promise<L> | null = null;

/** Leaflet touches `window` on import, so it is only ever loaded in the browser. */
export function loadLeaflet(): Promise<L> {
  if (!loading) loading = import("leaflet").then((m) => (m.default ?? m) as L);
  return loading;
}

export function useLeaflet(): { L: L | null; error: boolean } {
  const [state, setState] = useState<{ L: L | null; error: boolean }>({ L: null, error: false });
  useEffect(() => {
    let alive = true;
    loadLeaflet().then(
      (L) => alive && setState({ L, error: false }),
      () => alive && setState({ L: null, error: true })
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** A map with OpenStreetMap tiles and the attribution their licence requires. */
export function createMap(L: L, el: HTMLElement, opts: { zoom?: number; scrollWheelZoom?: boolean } = {}) {
  const map = L.map(el, {
    center: [51.5074, -0.1278],
    zoom: opts.zoom ?? 11,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: opts.scrollWheelZoom ?? false,
  });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

/** Round dot marker, optionally with a short label (A, B, 1…) inside it. */
export function dotMarker(
  L: L,
  lat: number,
  lng: number,
  color: string,
  title: string,
  glyph?: string,
  zIndexOffset = 0
) {
  const size = glyph ? 22 : 16;
  return L.marker([lat, lng], {
    title,
    zIndexOffset,
    keyboard: false,
    icon: L.divIcon({
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font:700 10px/1 system-ui,sans-serif;box-sizing:border-box;">${glyph ?? ""}</div>`,
    }),
  });
}
