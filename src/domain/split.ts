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
