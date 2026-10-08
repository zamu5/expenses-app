import { PEOPLE } from '@/config';
import type { Expense } from '@/db/types';

/** One line for expense lists: "Sergio paid · shared" or "Adriana paid · for Sergio". */
export function splitLabel(e: Pick<Expense, 'paidBy' | 'forWhom'>): string {
  const forWhom = e.forWhom === 'shared' ? 'shared' : `for ${PEOPLE[e.forWhom]}`;
  return `${PEOPLE[e.paidBy]} paid · ${forWhom}`;
}

/** "Adriana owes Sergio" / "All square", from describeBalance(). */
export function balanceSentence(
  balance: { debtor: keyof typeof PEOPLE; creditor: keyof typeof PEOPLE } | null,
): string {
  return balance ? `${PEOPLE[balance.debtor]} owes ${PEOPLE[balance.creditor]}` : 'All square';
}
