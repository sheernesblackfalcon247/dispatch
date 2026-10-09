/**
 * Proof that this browser is the one that started a checkout.
 *
 * A draft holds the customer's name, phone, email and both addresses so the form
 * can be refilled if they back out of SumUp. The draft id alone must therefore
 * not be enough to read it: someone who knew a victim's email and could
 * reproduce their exact trip could otherwise be handed that id — and with it,
 * their personal details.
 *
 * So the id is also written to an httpOnly cookie, and /api/payment/draft only
 * answers for ids this browser actually owns. Same browser goes to SumUp and
 * comes back, so the legitimate path always has it.
 */
const COOKIE = "tf_drafts";
const KEEP = 3;
const MAX_AGE = 40 * 60; // a little longer than the 30-minute draft window

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Draft ids this browser has open, newest first. */
export function draftsFromCookie(req: Request): string[] {
  const header = req.headers.get("cookie");
  if (!header) return [];
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return [];
  return decodeURIComponent(raw.slice(COOKIE.length + 1))
    .split(",")
    .map((s) => s.trim())
    .filter(isUuid);
}

export function ownsDraft(req: Request, draftId: string): boolean {
  return draftsFromCookie(req).includes(draftId);
}

/** Value for a Set-Cookie header that adds `draftId` to this browser's list. */
export function draftCookieValue(req: Request, draftId: string): string {
  const next = [draftId, ...draftsFromCookie(req).filter((d) => d !== draftId)].slice(0, KEEP);
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  // Lax, not Strict: the customer arrives back from SumUp's hosted page, and
  // Strict would withhold the cookie on that cross-site navigation.
  return `${COOKIE}=${encodeURIComponent(next.join(","))}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax;${secure}`;
}
