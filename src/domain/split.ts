import type { Cents } from './money';

/**
 * Who owes whom between the two people sharing expenses. Pure functions, like the budget math.
 * The ids are what the database stores. They are internal labels for "person 1" (the budget owner)
 * and "person 2", fixed since the first version; the names shown come from Settings.
 */

export type Person = 'sergio' | 'adriana';
/** Who an expense was for: both people (split by a percentage), or one person only. */
export type ForWhom = 'shared' | Person;

export const otherPerson = (p: Person): Person => (p === 'sergio' ? 'adriana' : 'sergio');

export interface SplitTotals {
  /** Shared expenses in full, by who paid. Only for display. */
  sharedPaidBy: Record<Person, Cents>;
  /** What the person who did not pay owes for those shared expenses, added up expense by expense. */
  sharedOwedTo: Record<Person, Cents>;
  /** Expenses for one person only that the other one paid. The payer is owed all of it. */
  paidForOtherBy: Record<Person, Cents>;
  /** Money already handed to the other person to settle up, by who gave it. */
  settledBy: Record<Person, Cents>;
  /**
   * The other person's part of the refunds the budget owner received: their share of a shared refund,
   * all of a refund that was only for them. The owner owes it back.
   */
  refundsOwedToOther: Cents;
}

/**
 * What the second person owes the first (the budget owner). Negative means the owner owes them;
 * 0 means all square.
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

/** The budget owner's share of a shared expense when nothing else was chosen: half. */
export const DEFAULT_OWNER_SHARE_PCT = 50;

/**
 * A share of an amount, in whole cents, rounded down. It is always the share of the person who
 * did NOT pay (or did not receive the money), so an odd cent stays with whoever paid:
 * 83.35 at 50% means the other person owes 41.67 and the payer keeps 41.68.
 * This one rule is behind every split number in the app.
 */
export function shareCents(amountCents: Cents, pct: number): Cents {
  return Math.floor((amountCents * pct) / 100);
}

/** What the database needs to know about an expense to split it. */
export interface SplitExpense {
  amountCents: Cents;
  paidBy: Person;
  forWhom: ForWhom;
  /** The owner's share of a shared expense, 0-100. Fixed when the expense was logged. */
  ownerSharePct?: number;
}

/**
 * What one expense costs the budget owner: all of it when it was only for them, none of it when
 * it was only for the other person, and for a shared one their percentage. The rest is what
 * expenseDebt() says is owed, so the two always add up to what was paid.
 */
export function ownerShareCents(expense: SplitExpense): Cents {
  if (expense.forWhom === BUDGET_OWNER) return expense.amountCents;
  if (expense.forWhom !== 'shared') return 0;
  const pct = expense.ownerSharePct ?? DEFAULT_OWNER_SHARE_PCT;
  return expense.paidBy === BUDGET_OWNER
    ? expense.amountCents - shareCents(expense.amountCents, 100 - pct)
    : shareCents(expense.amountCents, pct);
}

/** The two filters on the Expenses tab. They combine: e.g. shared expenses that the second person paid. */
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
 * A shared expense makes the person who did not pay owe their percentage; an expense that was
 * only for the other person makes them owe all of it; paying for yourself creates no debt (null).
 */
export function expenseDebt(expense: SplitExpense): { debtor: Person; cents: Cents } | null {
  if (expense.forWhom === expense.paidBy) return null;
  const debtor = otherPerson(expense.paidBy);
  if (expense.forWhom !== 'shared') return { debtor, cents: expense.amountCents };
  const ownerPct = expense.ownerSharePct ?? DEFAULT_OWNER_SHARE_PCT;
  const debtorPct = debtor === BUDGET_OWNER ? ownerPct : 100 - ownerPct;
  return { debtor, cents: shareCents(expense.amountCents, debtorPct) };
}

/** A refund: money the budget owner got back for something bought earlier. */
export interface SplitRefund {
  amountCents: Cents;
  forWhom: ForWhom;
  /** The owner's share of a shared refund, 0-100. Fixed when it was logged. */
  ownerSharePct?: number;
}

/**
 * The part of a refund that belongs to the other person, which the owner now owes them: their
 * percentage of a shared refund (the odd cent stays with the owner, who received it), all of one
 * that was only for them.
 */
export function refundOwedToOtherCents(refund: SplitRefund): Cents {
  if (refund.forWhom === BUDGET_OWNER) return 0;
  if (refund.forWhom !== 'shared') return refund.amountCents;
  return shareCents(refund.amountCents, 100 - (refund.ownerSharePct ?? DEFAULT_OWNER_SHARE_PCT));
}

/** The part of a refund that lowers the budget owner's own spending: the rest of it. */
export function refundOwnerShareCents(refund: SplitRefund): Cents {
  return refund.amountCents - refundOwedToOtherCents(refund);
}
