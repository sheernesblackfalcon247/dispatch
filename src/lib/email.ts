/**
 * Email sender via the Resend REST API (no SDK — plain fetch).
 *
 * The API key comes from RESEND_API_KEY in the environment (kept in .env /
 * Vercel — never in the DB or admin UI). The "from" address is admin-editable
 * config (app_settings), falling back to EMAIL_FROM. Gracefully no-ops when no
 * key is configured, so the app works before email is set up.
 */
import { getConfigValue } from "./settings";

const DEFAULT_FROM = "Black Falcon 247 Taxi <onboarding@resend.dev>";

export async function emailEnabled(): Promise<boolean> {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (to.length === 0) return false;
  const from = (await getConfigValue("notifications", "email_from", process.env.EMAIL_FROM)) || DEFAULT_FROM;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
