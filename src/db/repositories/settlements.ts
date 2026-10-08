import {
  BUDGET_OWNER,
  otherPerson,
  type ForWhom,
  type Person,
  type SplitTotals,
} from '@/domain/split';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db, Settlement } from '../types';

/**
 * The sums the balance between the two people is computed from (see domain/split.ts).
 * It covers every month: the balance is a running total, not a monthly one.
 */
export async function getSplitTotals(db: Db): Promise<SplitTotals> {
  // amount_cents / 2 is integer division: each expense's half is rounded down on its own,
  // the same rule as sharedHalfOwedCents().
  const expenses = await db.getAllAsync<{
    paid_by: Person;
    for_whom: ForWhom;
    total: number;
    halves: number;
  }>(
    `SELECT paid_by, for_whom, SUM(amount_cents) AS total, SUM(amount_cents / 2) AS halves
     FROM expenses WHERE deleted_at IS NULL GROUP BY paid_by, for_whom`,
    [],
  );
  const settlements = await db.getAllAsync<{ from_person: Person; total: number }>(
    `SELECT from_person, SUM(amount_cents) AS total FROM settlements
     WHERE deleted_at IS NULL GROUP BY from_person`,
    [],
  );
  // Refunds the owner received: the same rule as refundOwedToOtherCents(), refund by refund.
  const refunds = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(CASE WHEN for_whom = 'shared' THEN amount_cents / 2
                     WHEN for_whom <> ? THEN amount_cents
                     ELSE 0 END) AS total
     FROM incomes WHERE deleted_at IS NULL AND category_id IS NOT NULL`,
    [BUDGET_OWNER],
  );

  const spent = (paidBy: Person, forWhom: ForWhom) =>
    expenses.find((r) => r.paid_by === paidBy && r.for_whom === forWhom)?.total ?? 0;
  const halves = (paidBy: Person) =>
    expenses.find((r) => r.paid_by === paidBy && r.for_whom === 'shared')?.halves ?? 0;
  const settled = (from: Person) => settlements.find((r) => r.from_person === from)?.total ?? 0;

  return {
    sharedPaidBy: { sergio: spent('sergio', 'shared'), adriana: spent('adriana', 'shared') },
    sharedOwedTo: { sergio: halves('sergio'), adriana: halves('adriana') },
    paidForOtherBy: { sergio: spent('sergio', 'adriana'), adriana: spent('adriana', 'sergio') },
    settledBy: { sergio: settled('sergio'), adriana: settled('adriana') },
    refundsOwedToOther: refunds?.total ?? 0,
  };
}

/** Records that `fromPerson` handed money to the other person to pay back what they owed. */
export async function addSettlement(
  db: Db,
  input: { fromPerson: Person; amountCents: number; settledOn: string },
): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.runAsync(
    `INSERT INTO settlements (id, from_person, to_person, amount_cents, settled_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.fromPerson, otherPerson(input.fromPerson), input.amountCents, input.settledOn, now, now],
  );
  notifyDataChanged();
  return id;
}

export async function deleteSettlement(db: Db, id: string): Promise<void> {
  const now = nowISO();
  await db.runAsync('UPDATE settlements SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  notifyDataChanged();
}

/** Every payment between the two people, newest first. */
export async function listSettlements(db: Db): Promise<Settlement[]> {
  const rows = await db.getAllAsync<{
    id: string;
    from_person: Person;
    to_person: Person;
    amount_cents: number;
    settled_on: string;
  }>(
    `SELECT id, from_person, to_person, amount_cents, settled_on FROM settlements
     WHERE deleted_at IS NULL ORDER BY settled_on DESC, created_at DESC`,
    [],
  );
  return rows.map((r) => ({
    id: r.id,
    fromPerson: r.from_person,
    toPerson: r.to_person,
    amountCents: r.amount_cents,
    settledOn: r.settled_on,
  }));
}
