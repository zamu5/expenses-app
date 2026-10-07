import { getMonth, getMonthCategoryInputs } from '@/db/repositories/months';
import type { Month } from '@/db/types';
import { computeMonthSummary, type MonthSummary } from '@/domain/budget';
import { daysElapsed, daysInMonth, todayISO, type MonthKey } from '@/domain/dates';

import { useDbQuery } from './use-db-query';

export interface MonthView {
  month: Month | null;
  summary: MonthSummary;
  daysElapsed: number;
  daysInMonth: number;
}

/** Loads one month from SQLite and runs it through the pure budget math. */
export function useMonthSummary(monthKey: MonthKey) {
  return useDbQuery<MonthView>(
    async (db) => {
      const [month, categories] = await Promise.all([
        getMonth(db, monthKey),
        getMonthCategoryInputs(db, monthKey),
      ]);
      const total = daysInMonth(monthKey);
      const elapsed = daysElapsed(monthKey, todayISO());
      const summary = computeMonthSummary({
        startingBalanceCents: month?.startingBalanceCents ?? 0,
        categories,
        daysInMonth: total,
        daysElapsed: elapsed,
      });
      return { month, summary, daysElapsed: elapsed, daysInMonth: total };
    },
    [monthKey],
  );
}
