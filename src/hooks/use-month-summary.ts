import { getIncomeTotal } from '@/db/repositories/incomes';
import { getMonth, getMonthCategoryInputs } from '@/db/repositories/months';
import type { Db, Month } from '@/db/types';
import { computeMonthSummary, type MonthSummary } from '@/domain/budget';
import { daysElapsed, daysInMonth, todayISO, type MonthKey } from '@/domain/dates';

import { useDbQuery } from './use-db-query';

export interface MonthView {
  month: Month | null;
  summary: MonthSummary;
  daysElapsed: number;
  daysInMonth: number;
}

/**
 * Loads one month from SQLite and runs it through the pure budget math.
 * `startedWithCents` is what the month starts with, from the accounts (see computeStartedWith).
 * Screens that only look at categories can leave it out.
 */
export async function loadMonthView(
  db: Db,
  monthKey: MonthKey,
  startedWithCents = 0,
): Promise<MonthView> {
  const [month, categories, incomeCents] = await Promise.all([
    getMonth(db, monthKey),
    getMonthCategoryInputs(db, monthKey),
    getIncomeTotal(db, monthKey),
  ]);
  const total = daysInMonth(monthKey);
  const elapsed = daysElapsed(monthKey, todayISO());
  const summary = computeMonthSummary({
    startingBalanceCents: startedWithCents,
    incomeCents,
    categories,
    daysInMonth: total,
    daysElapsed: elapsed,
  });
  return { month, summary, daysElapsed: elapsed, daysInMonth: total };
}

export function useMonthSummary(monthKey: MonthKey) {
  return useDbQuery((db) => loadMonthView(db, monthKey), [monthKey]);
}
