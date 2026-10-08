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

export interface BudgetAccountFlows {
  startingBalanceCents: Cents;
  incomeCents: Cents;
  /** Every expense the owner paid this month, in full, whoever it was for. */
  paidByOwnerCents: Cents;
  /** Money the other person paid back this month, and money the owner paid them. */
  receivedFromOtherCents: Cents;
  paidToOtherCents: Cents;
}

/**
 * The money actually in the budget account: unlike the budget, this counts what left the account,
 * so a shared expense the owner paid comes out in full until the other half is paid back.
 */
export function budgetAccountCents(f: BudgetAccountFlows): Cents {
  return (
    f.startingBalanceCents +
    f.incomeCents -
    f.paidByOwnerCents +
    f.receivedFromOtherCents -
    f.paidToOtherCents
  );
}
