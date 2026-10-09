"use client";

import { useEffect, useState } from "react";

let loadPromise: Promise<void> | null = null;

/** Loads the Google Maps JS API (with Places) once, app-wide. */
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { google?: unknown }).google) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function useGoogleMaps() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      setError("no_key");
      return;
    }
    let active = true;
    loadGoogleMaps(apiKey)
      .then(() => active && setIsLoaded(true))
      .catch(() => active && setError("load_failed"));
    return () => {
      active = false;
    };
  }, [apiKey]);

  return { isLoaded, error, hasKey: Boolean(apiKey) };
}
