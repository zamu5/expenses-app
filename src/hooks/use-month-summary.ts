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
 * Loads one month from SQLite and runs it through the pure budget math. The month starts from
 * the amount saved with its plan (see the plan screen).
 */
export async function loadMonthView(db: Db, monthKey: MonthKey): Promise<MonthView> {
  const [month, categories, incomeCents] = await Promise.all([
    getMonth(db, monthKey),
    getMonthCategoryInputs(db, monthKey),
    getIncomeTotal(db, monthKey),
  ]);
  const total = daysInMonth(monthKey);
  const elapsed = daysElapsed(monthKey, todayISO());
  const summary = computeMonthSummary({
    startingBalanceCents: month?.startingBalanceCents ?? 0,
    incomeCents,
    expectedIncomeCents: month?.expectedIncomeCents ?? 0,
    categories,
    daysInMonth: total,
    daysElapsed: elapsed,
  });
  return { month, summary, daysElapsed: elapsed, daysInMonth: total };
}

export function useMonthSummary(monthKey: MonthKey) {
  return useDbQuery((db) => loadMonthView(db, monthKey), [monthKey]);
}
