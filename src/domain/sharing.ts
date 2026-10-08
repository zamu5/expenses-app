import type { Cents } from './money';

/**
 * Who owes whom between the two people sharing expenses. Pure functions, like the budget math.
 * 'me' is the owner of the phone and 'partner' is the other person; names live in config.ts.
 */

export type Person = 'me' | 'partner';
/** Who an expense was for: both people 50/50, or one person only. */
export type Split = 'shared' | Person;

export const otherPerson = (p: Person): Person => (p === 'me' ? 'partner' : 'me');

export interface SharingTotals {
  /** Shared expenses, by who paid. Each one is owed half by the other person. */
  sharedPaidByMeCents: Cents;
  sharedPaidByPartnerCents: Cents;
  /** Expenses for one person only that the other one paid. They are owed in full. */
  forPartnerPaidByMeCents: Cents;
  forMePaidByPartnerCents: Cents;
  /** Money already handed over to settle up. */
  settledByMeCents: Cents;
  settledByPartnerCents: Cents;
}

/**
 * What the partner owes me. Negative means I owe the partner; 0 means settled.
 * Halves are taken on the totals and rounded once, so odd cents do not pile up.
 */
export function partnerOwesMeCents(t: SharingTotals): Cents {
  const sharedHalf = Math.round((t.sharedPaidByMeCents - t.sharedPaidByPartnerCents) / 2);
  return (
    sharedHalf +
    t.forPartnerPaidByMeCents -
    t.forMePaidByPartnerCents +
    t.settledByMeCents -
    t.settledByPartnerCents
  );
}

/** The balance as a sentence-ready fact: who owes, who is owed, and how much. */
export function describeBalance(
  cents: Cents,
): { debtor: Person; creditor: Person; amountCents: Cents } | null {
  if (cents === 0) return null;
  return cents > 0
    ? { debtor: 'partner', creditor: 'me', amountCents: cents }
    : { debtor: 'me', creditor: 'partner', amountCents: -cents };
}
