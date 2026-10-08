import type { Cents } from './money';

/**
 * The net worth math behind the Accounts tab, as pure functions.
 * Every amount is in cents of its own currency; exchange rates are typed in by hand.
 */

export interface NetWorthItem {
  /** 'planned' is an expected expense: entered as a positive amount, counted as negative. */
  kind: 'account' | 'planned';
  currency: string;
  balanceCents: Cents;
}

export interface CurrencyTotal {
  currency: string;
  accountsCents: Cents;
  plannedCents: Cents;
  /** Accounts minus planned expenses, in this currency. */
  netCents: Cents;
  /** The net converted to the home currency. Null when no exchange rate has been set. */
  netHomeCents: Cents | null;
}

export interface NetWorth {
  /** One entry per currency, home currency first. */
  currencies: CurrencyTotal[];
  /** Everything that could be converted, in the home currency. */
  totalHomeCents: Cents;
  /** Currencies left out of the total because they have no exchange rate yet. */
  missingRates: string[];
}

/**
 * Converts an amount to the home currency. `unitsPerHome` is how much of the foreign currency
 * one unit of the home currency buys (1 CAD = 2950 COP -> 2950). Rounds once, to the cent.
 */
export function toHomeCents(cents: Cents, unitsPerHome: number): Cents {
  return Math.round(cents / unitsPerHome);
}

export function computeNetWorth(
  items: NetWorthItem[],
  rates: Record<string, number>,
  homeCurrency: string,
): NetWorth {
  const byCurrency = new Map<string, { accountsCents: Cents; plannedCents: Cents }>();
  for (const item of items) {
    const total = byCurrency.get(item.currency) ?? { accountsCents: 0, plannedCents: 0 };
    if (item.kind === 'planned') total.plannedCents += item.balanceCents;
    else total.accountsCents += item.balanceCents;
    byCurrency.set(item.currency, total);
  }

  const currencies = [...byCurrency.entries()]
    .map(([currency, t]): CurrencyTotal => {
      const netCents = t.accountsCents - t.plannedCents;
      const rate = currency === homeCurrency ? 1 : rates[currency];
      // Convert each currency's net once, so rounding does not pile up per account.
      return { currency, ...t, netCents, netHomeCents: rate ? toHomeCents(netCents, rate) : null };
    })
    .sort(
      (a, b) =>
        Number(b.currency === homeCurrency) - Number(a.currency === homeCurrency) ||
        a.currency.localeCompare(b.currency),
    );

  return {
    currencies,
    totalHomeCents: currencies.reduce((sum, c) => sum + (c.netHomeCents ?? 0), 0),
    missingRates: currencies.filter((c) => c.netHomeCents === null).map((c) => c.currency),
  };
}

/**
 * What a new month starts with: the current balance at the moment it is planned, that is,
 * everything in the accounts (credit cards count as negative), plus what the other person owes
 * (or minus what is owed to them), minus planned expenses. The budget still to spend is left
 * out on purpose: it belongs to the month being planned.
 */
export function computeStartingBalance(
  accounts: NetWorthItem[],
  owedCents: Cents,
  rates: Record<string, number>,
  homeCurrency: string,
): NetWorth {
  return computeNetWorth(
    [...accounts, { kind: 'account', currency: homeCurrency, balanceCents: owedCents }],
    rates,
    homeCurrency,
  );
}

/** Cleans what the user typed into an ISO 4217 code, or null when it is not three letters. */
export function parseCurrencyCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
