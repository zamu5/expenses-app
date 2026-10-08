import type { Cents } from './money';

/**
 * The budget math lives here as pure functions: no React, no database, no clock.
 * Everything the calculation needs comes in as arguments, which makes it trivial to unit test.
 */

export type CategoryStatus = 'onTrack' | 'watch' | 'over';
export type MonthStatus = 'onTrack' | 'watch' | 'danger';

export interface CategoryInput {
  id: string;
  name: string;
  /** Fixed costs (rent, subscriptions) are paid once, so their pace is meaningless. */
  isFixed: boolean;
  budgetCents: Cents;
  /** The budget owner's share of the spending: shared expenses count half (see domain/split.ts). */
  spentCents: Cents;
}

export interface CategorySummary extends CategoryInput {
  remainingCents: Cents;
  /** Spent divided by what an even pace would have spent by today. Null when it cannot be computed. */
  pace: number | null;
  status: CategoryStatus;
  /** What this category is expected to cost by the end of the month. */
  projectedSpendCents: Cents;
}

export interface MonthInput {
  startingBalanceCents: Cents;
  /** Money received during the month (salary, refunds). Defaults to 0. */
  incomeCents?: Cents;
  /** Income the plan expects this month (the salary). Defaults to 0. */
  expectedIncomeCents?: Cents;
  categories: CategoryInput[];
  daysInMonth: number;
  /** Days of the month that have passed, counting today (0 for a future month, all for a past one). */
  daysElapsed: number;
  /** A category is "watch" when its pace is above this. 1.10 means 10% tolerance. */
  paceTolerance?: number;
}

export interface MonthSummary {
  totalBudgetCents: Cents;
  totalSpentCents: Cents;
  totalIncomeCents: Cents;
  /** Money you should have right now: what you started with, plus income, minus spending. */
  currentBalanceCents: Cents;
  /**
   * Money left at the end if every category spends exactly its budget. Counts the expected income
   * until more than that has actually been received, so it is right before the salary arrives.
   */
  plannedEndCents: Cents;
  /** Money left at the end if you keep spending at today's pace. */
  projectedEndCents: Cents;
  status: MonthStatus;
  /** Linear pace is noisy in the first days of a month. */
  isEarlyEstimate: boolean;
  categories: CategorySummary[];
}

export const DEFAULT_PACE_TOLERANCE = 1.1;
const EARLY_ESTIMATE_DAYS = 3;

export function summarizeCategory(
  c: CategoryInput,
  daysInMonth: number,
  daysElapsed: number,
  paceTolerance = DEFAULT_PACE_TOLERANCE,
): CategorySummary {
  const remainingCents = c.budgetCents - c.spentCents;
  const monthIsOver = daysElapsed >= daysInMonth;

  let projectedSpendCents: Cents;
  if (monthIsOver) {
    // Nothing left to project: the month's spending is final.
    projectedSpendCents = c.spentCents;
  } else if (c.isFixed || daysElapsed === 0) {
    // Assume the budget will be paid in full, unless you already paid more.
    projectedSpendCents = Math.max(c.budgetCents, c.spentCents);
  } else {
    // Extrapolate today's pace linearly to the whole month. Round once, at the end.
    projectedSpendCents = Math.max(
      c.spentCents,
      Math.round((c.spentCents * daysInMonth) / daysElapsed),
    );
  }

  let pace: number | null = null;
  if (!c.isFixed && c.budgetCents > 0 && daysElapsed > 0) {
    const expectedByNow = (c.budgetCents * daysElapsed) / daysInMonth;
    pace = c.spentCents / expectedByNow;
  }

  let status: CategoryStatus = 'onTrack';
  if (c.spentCents > c.budgetCents) status = 'over';
  else if (pace !== null && pace > paceTolerance) status = 'watch';

  return { ...c, remainingCents, pace, status, projectedSpendCents };
}

export function computeMonthSummary(input: MonthInput): MonthSummary {
  const { startingBalanceCents, daysInMonth, daysElapsed } = input;
  const tolerance = input.paceTolerance ?? DEFAULT_PACE_TOLERANCE;

  const categories = input.categories.map((c) =>
    summarizeCategory(c, daysInMonth, daysElapsed, tolerance),
  );

  const sum = (pick: (c: CategorySummary) => Cents) =>
    categories.reduce((total, c) => total + pick(c), 0);

  const totalBudgetCents = sum((c) => c.budgetCents);
  const totalSpentCents = sum((c) => c.spentCents);
  const totalIncomeCents = input.incomeCents ?? 0;
  const availableCents = startingBalanceCents + totalIncomeCents;
  const currentBalanceCents = availableCents - totalSpentCents;
  const plannedIncomeCents = Math.max(totalIncomeCents, input.expectedIncomeCents ?? 0);
  const plannedEndCents = startingBalanceCents + plannedIncomeCents - totalBudgetCents;
  const projectedEndCents = availableCents - sum((c) => c.projectedSpendCents);

  // Danger: even sticking to the budget ends below zero. Watch: some category is already over.
  let status: MonthStatus = 'onTrack';
  if (plannedEndCents < 0) status = 'danger';
  else if (categories.some((c) => c.status === 'over')) status = 'watch';

  return {
    totalBudgetCents,
    totalSpentCents,
    totalIncomeCents,
    currentBalanceCents,
    plannedEndCents,
    projectedEndCents,
    status,
    isEarlyEstimate: daysElapsed > 0 && daysElapsed < EARLY_ESTIMATE_DAYS,
    categories,
  };
}

/**
 * Budget money not spent yet this month, added over the categories. A category that is already
 * over budget counts as 0, not as negative: overspending one does not free money in another.
 */
export function leftToSpendCents(categories: Pick<CategoryInput, 'budgetCents' | 'spentCents'>[]): Cents {
  return categories.reduce((total, c) => total + Math.max(0, c.budgetCents - c.spentCents), 0);
}

/**
 * Why a month has the status it has, in words for the legend on the Month tab.
 * Mirrors the rule in computeMonthSummary(): below zero is danger, a category over budget is watch.
 * `format` turns cents into text, so this stays free of currency and locale.
 */
export function explainMonthStatus(
  summary: Pick<MonthSummary, 'status' | 'categories' | 'plannedEndCents'>,
  format: (cents: Cents) => string,
): string {
  if (summary.status === 'danger') {
    return `Danger: the planned end is below zero by ${format(-summary.plannedEndCents)}. Your budgets add up to more than what you start with plus your income.`;
  }
  if (summary.status === 'watch') {
    const over = summary.categories
      .filter((c) => c.status === 'over')
      .map((c) => `${c.name} (by ${format(-c.remainingCents)})`);
    return `Watch: over budget in ${over.join(', ')}.`;
  }
  return 'On track: the planned end is above zero and no category is over its budget.';
}

/** A fixed cost (paid in one go) whose budget has been fully spent: nothing more to do this month. */
export function isPaidInFull(c: Pick<CategoryInput, 'isFixed' | 'budgetCents' | 'spentCents'>): boolean {
  return c.isFixed && c.budgetCents > 0 && c.spentCents >= c.budgetCents;
}

/** Puts the fixed costs that are already paid at the end; everything else keeps its order. */
export function sortPaidLast<T extends Pick<CategoryInput, 'isFixed' | 'budgetCents' | 'spentCents'>>(
  categories: T[],
): T[] {
  return [...categories.filter((c) => !isPaidInFull(c)), ...categories.filter(isPaidInFull)];
}
