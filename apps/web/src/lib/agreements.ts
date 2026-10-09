/**
 * Service agreements, as figures.
 *
 * An agreement's amount is stated per period, and a client can hold several at once, so the only
 * number that can be compared between clients is a monthly one. The conversions below are the
 * literal ones — a week is 12/52 of a month, a quarter is three months — because anything cleverer
 * would be an estimate dressed up as a fact.
 */

/** How many months each billing period covers. Periods that do not recur are absent on purpose. */
const PERIOD_MONTHS: Record<string, number> = {
  weekly: 12 / 52,
  monthly: 1,
  quarterly: 3,
  semi_annually: 6,
  annually: 12,
};

/**
 * The monthly value of a set of agreements. One-off agreements are skipped rather than divided into
 * a month they do not cover, and an unrecognised period is skipped rather than assumed to be
 * monthly, so an unknown value can never inflate the total.
 */
export function monthlyValue(agreements: Array<Record<string, any>> | undefined | null): { amount: number; currency: string } {
  const list = agreements ?? [];
  let amount = 0;
  for (const a of list) {
    const months = PERIOD_MONTHS[a?.billingPeriod];
    if (months === undefined) continue;
    amount += (Number(a?.billingAmount) || 0) / months;
  }
  return { amount, currency: list[0]?.currency ?? "USD" };
}

/** `$2,500` — or `—` when nothing recurs, so a card never claims a zero it does not mean. */
export function monthlyLabel(amount: number, currency = "USD"): string {
  if (!(amount > 0)) return "—";
  return amount.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
}
