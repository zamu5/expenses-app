import type { MonthKey } from '@/domain/dates';
import type { ForWhom, Person } from '@/domain/split';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db, Expense } from '../types';

interface ExpenseRow {
  id: string;
  category_id: string;
  amount_cents: number;
  spent_on: string;
  note: string | null;
  paid_by: Person;
  for_whom: ForWhom;
}

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  categoryId: r.category_id,
  amountCents: r.amount_cents,
  spentOn: r.spent_on,
  note: r.note,
  paidBy: r.paid_by,
  forWhom: r.for_whom,
});

const COLUMNS = 'id, category_id, amount_cents, spent_on, note, paid_by, for_whom';

export interface ExpenseInput {
  categoryId: string;
  amountCents: number;
  spentOn: string;
  note?: string | null;
  /** Who paid. Defaults to Sergio. */
  paidBy?: Person;
  /** Who it was for: both 50/50, or one person only. Defaults to 'shared'. */
  forWhom?: ForWhom;
}

const cleanNote = (note?: string | null) => (note?.trim() ? note.trim() : null);

export async function addExpense(db: Db, input: ExpenseInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.runAsync(
    `INSERT INTO expenses
       (id, category_id, amount_cents, spent_on, note, paid_by, for_whom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.categoryId,
      input.amountCents,
      input.spentOn,
      cleanNote(input.note),
      input.paidBy ?? 'sergio',
      input.forWhom ?? 'shared',
      now,
      now,
    ],
  );
  notifyDataChanged();
  return id;
}

export async function updateExpense(db: Db, id: string, input: ExpenseInput): Promise<void> {
  await db.runAsync(
    `UPDATE expenses SET category_id = ?, amount_cents = ?, spent_on = ?, note = ?,
       paid_by = ?, for_whom = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.categoryId,
      input.amountCents,
      input.spentOn,
      cleanNote(input.note),
      input.paidBy ?? 'sergio',
      input.forWhom ?? 'shared',
      nowISO(),
      id,
    ],
  );
  notifyDataChanged();
}

/** Soft delete: the row stays as a "tombstone" so a future sync can tell other devices about it. */
export async function deleteExpense(db: Db, id: string): Promise<void> {
  const now = nowISO();
  await db.runAsync('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  notifyDataChanged();
}

export async function getExpense(db: Db, id: string): Promise<Expense | null> {
  const row = await db.getFirstAsync<ExpenseRow>(
    `SELECT ${COLUMNS} FROM expenses WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? toExpense(row) : null;
}

/** Expenses of one month, newest first. `spent_on` is 'YYYY-MM-DD', so a month is a text prefix. */
export async function listExpenses(
  db: Db,
  month: MonthKey,
  categoryId?: string,
): Promise<Expense[]> {
  const rows = await db.getAllAsync<ExpenseRow>(
    `SELECT ${COLUMNS} FROM expenses
     WHERE deleted_at IS NULL AND spent_on LIKE ? ${categoryId ? 'AND category_id = ?' : ''}
     ORDER BY spent_on DESC, created_at DESC`,
    categoryId ? [`${month}-%`, categoryId] : [`${month}-%`],
  );
  return rows.map(toExpense);
}

/**
 * Every expense, from any month, that makes one person owe the other (see expenseDebt), newest
 * first, with its category name for when there is no note.
 */
export async function listDebtExpenses(db: Db): Promise<(Expense & { categoryName: string })[]> {
  const rows = await db.getAllAsync<ExpenseRow & { category_name: string }>(
    `SELECT e.id, e.category_id, e.amount_cents, e.spent_on, e.note, e.paid_by, e.for_whom,
            c.name AS category_name
     FROM expenses e JOIN categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL AND e.for_whom <> e.paid_by
     ORDER BY e.spent_on DESC, e.created_at DESC`,
    [],
  );
  return rows.map((r) => ({ ...toExpense(r), categoryName: r.category_name }));
}
