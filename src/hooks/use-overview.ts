import { CURRENCY } from '@/config';
import { listAccounts, listExchangeRates } from '@/db/repositories/accounts';
import { getSplitTotals } from '@/db/repositories/settlements';
import type { Account, Db, ExchangeRate } from '@/db/types';
import {
  computeNetWorth,
  computeStartingBalance,
  type NetWorth,
  type NetWorthItem,
} from '@/domain/accounts';
import { leftToSpendCents } from '@/domain/budget';
import type { MonthKey } from '@/domain/dates';
import { balanceCents } from '@/domain/split';

import { useDbQuery } from './use-db-query';
import { loadMonthView, type MonthView } from './use-month-summary';

export interface Overview {
  /** The month's budget math, starting from the amount saved with its plan. */
  monthView: MonthView;
  accounts: Account[];
  rates: ExchangeRate[];
  /** What the other person owes the owner across all months. Negative: the owner owes them. */
  owedCents: number;
  /** Budget of the month not spent yet. Counted against the total, like a planned expense. */
  leftToSpendCents: number;
  /** Everything in one number: accounts + what is owed - planned expenses - left to spend. */
  netWorth: NetWorth;
  /**
   * The current balance without the budget still to spend: what a month planned right now would
   * start with (see computeStartingBalance).
   */
  startingBalance: NetWorth;
}

/**
 * Everything the Accounts tab shows, and the numbers on the Month tab's balance card.
 * Account balances are typed by hand. Two rows are worked out by the app instead: what the two
 * people owe each other, and what is left to spend this month.
 */
export async function loadOverview(db: Db, monthKey: MonthKey): Promise<Overview> {
  const [accounts, rates, splitTotals, monthView] = await Promise.all([
    listAccounts(db),
    listExchangeRates(db),
    getSplitTotals(db),
    loadMonthView(db, monthKey),
  ]);
  const rateOf = Object.fromEntries(rates.map((r) => [r.currency, r.unitsPerHome]));

  const leftCents = monthView.month ? leftToSpendCents(monthView.summary.categories) : 0;
  const owedCents = balanceCents(splitTotals);
  const items: NetWorthItem[] = [
    ...accounts,
    { kind: 'account', currency: CURRENCY, balanceCents: owedCents },
    { kind: 'planned', currency: CURRENCY, balanceCents: leftCents },
  ];

  return {
    monthView,
    accounts,
    rates,
    owedCents,
    leftToSpendCents: leftCents,
    netWorth: computeNetWorth(items, rateOf, CURRENCY),
    startingBalance: computeStartingBalance(accounts, owedCents, rateOf, CURRENCY),
  };
}

export function useOverview(monthKey: MonthKey) {
  return useDbQuery((db) => loadOverview(db, monthKey), [monthKey]);
}
