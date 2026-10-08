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
  /** Shared expenses in full, by who paid. Only for display. */
  sharedPaidBy: Record<Person, Cents>;
  /** The other person's half of those shared expenses, added up expense by expense. */
  sharedOwedTo: Record<Person, Cents>;
  /** Expenses for one person only that the other one paid. The payer is owed all of it. */
  paidForOtherBy: Record<Person, Cents>;
  /** Money already handed to the other person to settle up, by who gave it. */
  settledBy: Record<Person, Cents>;
  /**
   * The other person's part of the refunds the budget owner received: half of a shared refund,
   * all of a refund that was only for them. The owner owes it back.
   */
  refundsOwedToOther: Cents;
}

/**
 * What Adriana owes Sergio. Negative means Sergio owes Adriana; 0 means all square.
 * It is the sum of expenseDebt() over every expense, minus the payments between the two,
 * so the lines on the Balance screen always add up to it exactly.
 */
export function balanceCents(t: SplitTotals): Cents {
  return (
    (t.sharedOwedTo.sergio - t.sharedOwedTo.adriana) +
    (t.paidForOtherBy.sergio - t.paidForOtherBy.adriana) +
    (t.settledBy.sergio - t.settledBy.adriana) -
    t.refundsOwedToOther
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
 * The other person's half of a shared expense. An odd cent stays with whoever paid:
 * 83.35 shared means the other person owes 41.67 and the payer keeps 41.68.
 * This one rule is behind every split number in the app.
 */
export function sharedHalfOwedCents(amountCents: Cents): Cents {
  return Math.floor(amountCents / 2);
}

/**
 * What one expense costs the budget owner: all of it when it was only for them, none of it when
 * it was only for the other person, and for a shared one their half (the bigger half by a cent
 * when they paid and the amount is odd). The rest is what expenseDebt() says is owed.
 */
export function ownerShareCents(expense: {
  amountCents: Cents;
  paidBy: Person;
  forWhom: ForWhom;
}): Cents {
  if (expense.forWhom === BUDGET_OWNER) return expense.amountCents;
  if (expense.forWhom !== 'shared') return 0;
  const otherHalf = sharedHalfOwedCents(expense.amountCents);
  return expense.paidBy === BUDGET_OWNER ? expense.amountCents - otherHalf : otherHalf;
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
    cents:
      expense.forWhom === 'shared' ? sharedHalfOwedCents(expense.amountCents) : expense.amountCents,
  };
}

/**
 * A refund is money the budget owner got back for something bought earlier. This is the part of
 * it that belongs to the other person, which the owner now owes them: half of a shared refund
 * (the odd cent stays with the owner, who received it), all of one that was only for them.
 */
export function refundOwedToOtherCents(refund: { amountCents: Cents; forWhom: ForWhom }): Cents {
  if (refund.forWhom === BUDGET_OWNER) return 0;
  return refund.forWhom === 'shared' ? sharedHalfOwedCents(refund.amountCents) : refund.amountCents;
}

/** The part of a refund that lowers the budget owner's own spending: the rest of it. */
export function refundOwnerShareCents(refund: { amountCents: Cents; forWhom: ForWhom }): Cents {
  return refund.amountCents - refundOwedToOtherCents(refund);
}
