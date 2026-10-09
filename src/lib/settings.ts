import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Runtime configuration resolver for non-secret, admin-editable settings.
 *
 * CONFIG lives in `app_settings` (jsonb) and falls back to environment
 * variables when unset, so nothing breaks before the admin fills it in. Values
 * are cached briefly to avoid a DB hit on every request.
 *
 * NOTE: Secret keys (SumUp/Resend/Cosmic SMS) are NOT stored here — they stay
 * in the environment (.env / Vercel) only, read directly via process.env.
 */
type CacheEntry = { v: string | undefined; exp: number };
const cache = new Map<string, CacheEntry>();
const TTL = 30_000;

/** A non-secret config value from an app_settings jsonb key/field → env fallback. */
export async function getConfigValue(
  key: string,
  field: string,
  fallback?: string
): Promise<string | undefined> {
  const cacheKey = `cfg:${key}.${field}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > now) return hit.v ?? fallback;
  let v: string | undefined;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
    const val = (data?.value as Record<string, unknown> | null)?.[field];
    v = typeof val === "string" && val.trim() ? val : undefined;
  } catch {
    v = undefined;
  }
  cache.set(cacheKey, { v, exp: now + TTL });
  return v ?? fallback;
}

/** Drop the cache immediately (call after an admin saves settings). */
export function clearSettingsCache() {
  cache.clear();
}
