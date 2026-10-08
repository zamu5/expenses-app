import { CURRENCY } from '@/config';
import { listAccounts, listExchangeRates } from '@/db/repositories/accounts';
import { getBudgetAccountFlows } from '@/db/repositories/months';
import { getSplitTotals } from '@/db/repositories/settlements';
import type { Account, Db, ExchangeRate } from '@/db/types';
import {
  computeNetWorth,
  computeStartedWith,
  type NetWorth,
  type NetWorthItem,
} from '@/domain/accounts';
import { leftToSpendCents } from '@/domain/budget';
import type { MonthKey } from '@/domain/dates';
import { balanceCents, budgetAccountCents } from '@/domain/split';

import { useDbQuery } from './use-db-query';
import { loadMonthView, type MonthView } from './use-month-summary';

export interface Overview {
  monthView: MonthView;
  /** The accounts as saved, with the budget account's balance filled in from the month. */
  accounts: Account[];
  rates: ExchangeRate[];
  /** Money in the budget account right now, from what was really paid in and out this month. */
  budgetAccountCents: number;
  /** True when one of the accounts is marked as the budget account. */
  hasBudgetAccount: boolean;
  /** What the other person owes the owner across all months. Negative: the owner owes them. */
  owedCents: number;
  /** Budget of the month not spent yet. Counted against the total, like a planned expense. */
  leftToSpendCents: number;
  /** Everything above in one number: accounts + what is owed - planned expenses - left to spend. */
  netWorth: NetWorth;
  /**
   * What the month started with across everything: the other accounts, plus the budget account's
   * starting balance from the month's plan, minus planned expenses. Other accounts keep no history,
   * so their balance as it is today is used.
   */
  startedWithCents: number;
}

/**
 * Everything the Accounts tab shows, and the single total the Month tab calls "Current balance".
 * Three rows are worked out by the app instead of typed: the budget account (when one is marked),
 * what the two people owe each other, and what is left to spend this month.
 */
export async function loadOverview(db: Db, monthKey: MonthKey): Promise<Overview> {
  const [saved, rates, monthView, flows, splitTotals] = await Promise.all([
    listAccounts(db),
    listExchangeRates(db),
    loadMonthView(db, monthKey),
    getBudgetAccountFlows(db, monthKey),
    getSplitTotals(db),
  ]);

  const isPlanned = monthView.month !== null;
  const budgetCents = isPlanned ? budgetAccountCents(flows) : 0;
  const leftCents = isPlanned ? leftToSpendCents(monthView.summary.categories) : 0;
  const owedCents = balanceCents(splitTotals);

  const accounts = saved.map((a) => (a.isBudgetAccount ? { ...a, balanceCents: budgetCents } : a));
  const hasBudgetAccount = accounts.some((a) => a.isBudgetAccount);

  const items: NetWorthItem[] = [
    ...accounts,
    { kind: 'account', currency: CURRENCY, balanceCents: owedCents },
    { kind: 'planned', currency: CURRENCY, balanceCents: leftCents },
  ];
  const rateOf = Object.fromEntries(rates.map((r) => [r.currency, r.unitsPerHome]));

  return {
    monthView,
    accounts,
    rates,
    budgetAccountCents: budgetCents,
    hasBudgetAccount,
    owedCents,
    leftToSpendCents: leftCents,
    netWorth: computeNetWorth(items, rateOf, CURRENCY),
    startedWithCents: computeStartedWith(
      saved,
      monthView.month?.startingBalanceCents ?? 0,
      rateOf,
      CURRENCY,
    ).totalHomeCents,
  };
}

export function useOverview(monthKey: MonthKey) {
  return useDbQuery((db) => loadOverview(db, monthKey), [monthKey]);
}
