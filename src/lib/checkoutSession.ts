/**
 * Remembering which checkout this tab walked away from.
 *
 * SumUp's hosted page has no "back to the shop" link, so a customer who
 * changes their mind uses the browser's back button — which just replays the
 * booking page, and React state does not survive a cross-origin round trip.
 * Without this the customer comes back to an empty form and has to type two
 * addresses, a phone number and an email again.
 *
 * sessionStorage is deliberate: per-tab, and gone when the tab closes, which is
 * exactly the lifetime of "I was in the middle of paying".
 */
const KEY = "blackfalcon:checkout-draft";

export function rememberCheckout(draftId: string): void {
  try {
    sessionStorage.setItem(KEY, draftId);
  } catch {
    /* private mode / storage disabled — the ?resume= link still works */
  }
}

export function rememberedCheckout(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetCheckout(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}
