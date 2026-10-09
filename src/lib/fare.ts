/**
 * Splitting a whole-trip total back across an outbound/return pair.
 *
 * A return trip is stored as two booking rows, and almost everything downstream
 * — cash collection, driver settlement, analytics — reads the per-leg
 * `estimated_fare`. So whenever a trip total is set as a single number (a staff
 * custom price, or the amount SumUp actually charged), it has to be pushed back
 * into the legs in a way that still sums to that total.
 */
export function splitFare(total: number, outOriginal: number, retOriginal: number): { out: number; ret: number } {
  const sum = outOriginal + retOriginal;
  // In proportion to what each leg originally cost; an even split only when we
  // have nothing to go on.
  const out =
    sum > 0 ? Math.round(total * (outOriginal / sum) * 100) / 100 : Math.round((total / 2) * 100) / 100;
  // The remainder, so rounding can never lose or invent a penny.
  return { out, ret: Math.round((total - out) * 100) / 100 };
}
