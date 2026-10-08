import { CURRENCY } from '@/config';
import { listAccounts, listExchangeRates } from '@/db/repositories/accounts';
import { listExpenses } from '@/db/repositories/expenses';
import { listIncomes } from '@/db/repositories/incomes';
import { getSplitTotals } from '@/db/repositories/settlements';
import type { Account, Db, ExchangeRate } from '@/db/types';
import {
  computeNetWorth,
  computeStartedWith,
  depositsIntoStartCents,
  type NetWorth,
  type NetWorthItem,
} from '@/domain/accounts';
import { leftToSpendCents } from '@/domain/budget';
import type { MonthKey } from '@/domain/dates';
import { balanceCents } from '@/domain/split';

import { useDbQuery } from './use-db-query';
import { loadMonthView, type MonthView } from './use-month-summary';

export interface Overview {
  /** The month's budget math, starting from `startedWithCents`. */
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
   * What the month starts with: accounts marked "include in starting balance" minus planned
   * expenses. Accounts keep no history, so their balance as it is today is used.
   */
  startedWith: NetWorth;
  /**
   * `startedWith` with this month's movements undone: minus the income and refunds paid into those
   * accounts, plus the expenses paid from them. Both are already in the balances, and the month
   * counts them separately.
   */
  startedWithCents: number;
}

/**
 * Everything the Accounts tab shows, and the numbers on the Month tab's balance card.
 * Account balances are typed by hand. Two rows are worked out by the app instead: what the two
 * people owe each other, and what is left to spend this month.
 */
export async function loadOverview(db: Db, monthKey: MonthKey): Promise<Overview> {
  const [accounts, rates, splitTotals, incomes, expenses] = await Promise.all([
    listAccounts(db),
    listExchangeRates(db),
    getSplitTotals(db),
    listIncomes(db, monthKey),
    listExpenses(db, monthKey),
  ]);
  const rateOf = Object.fromEntries(rates.map((r) => [r.currency, r.unitsPerHome]));

  const startedWith = computeStartedWith(accounts, rateOf, CURRENCY);
  // The balances already hold this month's income and payments; undo both to get the start.
  const paidCents = depositsIntoStartCents(
    expenses.map((e) => ({ accountId: e.paymentAccountId, amountCents: e.amountCents })),
    accounts,
  );
  const startedWithCents =
    startedWith.totalHomeCents - depositsIntoStartCents(incomes, accounts) + paidCents;
  const monthView = await loadMonthView(db, monthKey, startedWithCents);

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
    startedWith,
    startedWithCents,
  };
}

export function useOverview(monthKey: MonthKey) {
  return useDbQuery((db) => loadOverview(db, monthKey), [monthKey]);
}
