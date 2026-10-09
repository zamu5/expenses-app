import type { PeopleNames } from '@/db/repositories/settings';
import type { Expense } from '@/db/types';
import type { Person } from '@/domain/split';

/** One line for expense lists: "<payer> paid · shared" or "<payer> paid · for <other>". */
export function splitLabel(e: Pick<Expense, 'paidBy' | 'forWhom'>, people: PeopleNames): string {
  const forWhom = e.forWhom === 'shared' ? 'shared' : `for ${people[e.forWhom]}`;
  return `${people[e.paidBy]} paid · ${forWhom}`;
}

/** "<debtor> owes <creditor>" / "All square", from describeBalance(). */
export function balanceSentence(
  balance: { debtor: Person; creditor: Person } | null,
  people: PeopleNames,
): string {
  return balance ? `${people[balance.debtor]} owes ${people[balance.creditor]}` : 'All square';
}
