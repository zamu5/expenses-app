import type { Cents } from './money';

/**
 * Who owes whom between the two people sharing expenses. Pure functions, like the budget math.
 * The ids are what the database stores; display names live in config.ts.
 */

export type Person = 'sergio' | 'adriana';
/** Who an expense was for: both people 50/50, or one person only. */
export type ForWhom = 'shared' | Person;

export const otherPerson = (p: Person): Person => (p === 'sergio' ? 'adriana' : 'sergio');

export interface SplitTotals {
  /** Shared expenses, by who paid. The payer is owed half by the other person. */
  sharedPaidBy: Record<Person, Cents>;
  /** Expenses for one person only that the other one paid. The payer is owed all of it. */
  paidForOtherBy: Record<Person, Cents>;
  /** Money already handed to the other person to settle up, by who gave it. */
  settledBy: Record<Person, Cents>;
}

/**
 * What Adriana owes Sergio. Negative means Sergio owes Adriana; 0 means all square.
 * Halves are taken on the totals and rounded once, so odd cents do not pile up.
 */
export function balanceCents(t: SplitTotals): Cents {
  const sharedHalf = Math.round((t.sharedPaidBy.sergio - t.sharedPaidBy.adriana) / 2);
  return (
    sharedHalf +
    (t.paidForOtherBy.sergio - t.paidForOtherBy.adriana) +
    (t.settledBy.sergio - t.settledBy.adriana)
  );
}

/** The balance as a sentence-ready fact: who owes, who is owed, and how much. Null when square. */
export function describeBalance(
  cents: Cents,
): { debtor: Person; creditor: Person; amountCents: Cents } | null {
  if (cents === 0) return null;
  return cents > 0
    ? { debtor: 'adriana', creditor: 'sergio', amountCents: cents }
    : { debtor: 'sergio', creditor: 'adriana', amountCents: -cents };
}

/** The person whose budget and accounts this app tracks. The other one is who they split with. */
export const BUDGET_OWNER: Person = 'sergio';

/**
 * What a set of expenses costs the budget owner: all of what was only for them, half of what was
 * shared, and none of what was only for the other person. Who paid does not matter here, because
 * whatever the other person owes (or is owed) is tracked in the balance between the two.
 * Takes totals, so the half is rounded once.
 */
export function ownerShareCents(onlyForOwnerCents: Cents, sharedCents: Cents): Cents {
  return onlyForOwnerCents + Math.round(sharedCents / 2);
}

/** The two filters on the Expenses tab. They combine: e.g. shared expenses that Adriana paid. */
export interface SplitFilter {
  paidBy: 'all' | Person;
  forWhom: 'all' | ForWhom;
}

export const NO_SPLIT_FILTER: SplitFilter = { paidBy: 'all', forWhom: 'all' };

export function matchesSplitFilter(
  expense: { paidBy: Person; forWhom: ForWhom },
  filter: SplitFilter,
): boolean {
  return (
    (filter.paidBy === 'all' || expense.paidBy === filter.paidBy) &&
    (filter.forWhom === 'all' || expense.forWhom === filter.forWhom)
  );
}

/**
 * What one expense adds to the balance between the two people: who owes, and how much.
 * A shared expense makes the other person owe half; an expense that was only for the other
 * person makes them owe all of it; paying for yourself creates no debt (null).
 */
export function expenseDebt(expense: {
  amountCents: Cents;
  paidBy: Person;
  forWhom: ForWhom;
}): { debtor: Person; cents: Cents } | null {
  if (expense.forWhom === expense.paidBy) return null;
  const debtor = otherPerson(expense.paidBy);
  return {
    debtor,
    cents: expense.forWhom === 'shared' ? Math.round(expense.amountCents / 2) : expense.amountCents,
  };
}
