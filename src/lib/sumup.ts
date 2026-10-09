/**
 * Server-only SumUp client. Never import into a client component.
 *
 * Talks to the SumUp REST API directly with fetch — the handful of calls we
 * need (create, read and deactivate a checkout) don't justify an SDK dependency.
 *
 * Configuration lives in the environment (.env / Vercel — never the DB or the
 * admin UI):
 *
 *   SUMUP_API_KEY        secret API key (sup_sk_…), SumUp Dashboard → Developers → API keys
 *   SUMUP_MERCHANT_CODE  the merchant code money is paid to (e.g. MCXXXXXX),
 *                        shown in the SumUp Dashboard under your profile
 *
 * When either is missing, card payments are simply unavailable.
 */

const API = "https://api.sumup.com";

export type CheckoutStatus = "PENDING" | "FAILED" | "PAID" | "EXPIRED";

export interface SumUpTransaction {
  id?: string;
  transaction_code?: string;
  amount?: number;
  currency?: string;
  status?: "SUCCESSFUL" | "CANCELLED" | "FAILED" | "PENDING" | "REFUNDED";
  timestamp?: string;
}

export interface SumUpCheckout {
  id: string;
  checkout_reference?: string;
  amount?: number;
  currency?: string;
  status?: CheckoutStatus;
  valid_until?: string | null;
  hosted_checkout_url?: string;
  transaction_id?: string;
  transaction_code?: string;
  transactions?: SumUpTransaction[];
}

export class SumUpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
  }
}

export interface SumUp {
  merchantCode: string;
  createCheckout(body: {
    checkout_reference: string;
    amount: number;
    currency: "GBP";
    description?: string;
    redirect_url?: string;
    return_url?: string;
    valid_until?: string;
  }): Promise<SumUpCheckout>;
  getCheckout(id: string): Promise<SumUpCheckout>;
  deactivateCheckout(id: string): Promise<void>;
}

/** True when card payments are switched on for this deployment. */
export function sumupConfigured(): boolean {
  return Boolean(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);
}

export function getSumUp(): SumUp | null {
  const key = process.env.SUMUP_API_KEY;
  const merchantCode = process.env.SUMUP_MERCHANT_CODE;
  if (!key || !merchantCode) return null;

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    // One retry on a network failure or 5xx. Only reads and the checkout create
    // (unique checkout_reference — SumUp rejects a duplicate) are safe to repeat.
    const attempts = method === "GET" || path === "/v0.1/checkouts" ? 2 : 1;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${API}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        const data = text ? safeJson(text) : null;
        if (res.ok) return data as T;
        if (res.status < 500) throw new SumUpError(`SumUp ${method} ${path} → ${res.status}`, res.status, data);
        lastErr = new SumUpError(`SumUp ${method} ${path} → ${res.status}`, res.status, data);
      } catch (err) {
        if (err instanceof SumUpError && err.status < 500) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  };

  return {
    merchantCode,
    createCheckout: (body) =>
      call<SumUpCheckout>("POST", "/v0.1/checkouts", {
        ...body,
        merchant_code: merchantCode,
        hosted_checkout: { enabled: true },
      }),
    getCheckout: (id) => call<SumUpCheckout>("GET", `/v0.1/checkouts/${encodeURIComponent(id)}`),
    deactivateCheckout: async (id) => {
      await call("DELETE", `/v0.1/checkouts/${encodeURIComponent(id)}`);
    },
  };
}

/** The transaction that actually took the money for a PAID checkout. */
export function paidTransaction(c: SumUpCheckout): SumUpTransaction | null {
  const list = c.transactions ?? [];
  return (
    list.find((t) => t.status === "SUCCESSFUL") ??
    list.find((t) => t.id && t.id === c.transaction_id) ??
    (c.transaction_id ? { id: c.transaction_id, transaction_code: c.transaction_code, amount: c.amount } : null)
  );
}

export const round2 = (n: number) => Math.round(Number(n) * 100) / 100;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
