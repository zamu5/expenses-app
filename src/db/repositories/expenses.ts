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
  payment_account_id: string | null;
}

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  categoryId: r.category_id,
  amountCents: r.amount_cents,
  spentOn: r.spent_on,
  note: r.note,
  paidBy: r.paid_by,
  forWhom: r.for_whom,
  paymentAccountId: r.payment_account_id,
});

const COLUMNS = 'id, category_id, amount_cents, spent_on, note, paid_by, for_whom, payment_account_id';

export interface ExpenseInput {
  categoryId: string;
  amountCents: number;
  spentOn: string;
  note?: string | null;
  /** Who paid. Defaults to the budget owner. */
  paidBy?: Person;
  /** Who it was for: both 50/50, or one person only. Defaults to 'shared'. */
  forWhom?: ForWhom;
  /**
   * The account or credit card it was paid with. Its balance goes down by the full amount
   * (a card's debt grows). Leave empty when the other person paid: it is not the owner's money.
   */
  paymentAccountId?: string | null;
}

const cleanNote = (note?: string | null) => (note?.trim() ? note.trim() : null);

/** Moves an account's balance by `deltaCents`; a payment is a negative move. */
async function moveBalance(db: Db, accountId: string | null, deltaCents: number, now: string): Promise<void> {
  if (!accountId || deltaCents === 0) return;
  await db.runAsync('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?', [
    deltaCents,
    now,
    accountId,
  ]);
}

// The three writes below do not open a transaction or notify, so they can be combined
// (see saveExpenseWithPart). The exported functions wrap them.

async function insertExpense(db: Db, input: ExpenseInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.runAsync(
    `INSERT INTO expenses
       (id, category_id, amount_cents, spent_on, note, paid_by, for_whom, payment_account_id,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.categoryId,
      input.amountCents,
      input.spentOn,
      cleanNote(input.note),
      input.paidBy ?? 'sergio',
      input.forWhom ?? 'shared',
      input.paymentAccountId ?? null,
      now,
      now,
    ],
  );
  await moveBalance(db, input.paymentAccountId ?? null, -input.amountCents, now);
  return id;
}

async function changeExpense(db: Db, id: string, input: ExpenseInput): Promise<void> {
  const now = nowISO();
  const before = await getExpense(db, id);
  if (!before) throw new Error('This expense no longer exists');
  await db.runAsync(
    `UPDATE expenses SET category_id = ?, amount_cents = ?, spent_on = ?, note = ?,
       paid_by = ?, for_whom = ?, payment_account_id = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.categoryId,
      input.amountCents,
      input.spentOn,
      cleanNote(input.note),
      input.paidBy ?? 'sergio',
      input.forWhom ?? 'shared',
      input.paymentAccountId ?? null,
      now,
      id,
    ],
  );
  // Give back what the old version took, then take what the new one costs.
  await moveBalance(db, before.paymentAccountId, before.amountCents, now);
  await moveBalance(db, input.paymentAccountId ?? null, -input.amountCents, now);
}

export async function addExpense(db: Db, input: ExpenseInput): Promise<string> {
  let id = '';
  await db.withTransactionAsync(async () => {
    id = await insertExpense(db, input);
  });
  notifyDataChanged();
  return id;
}

export async function updateExpense(db: Db, id: string, input: ExpenseInput): Promise<void> {
  await db.withTransactionAsync(() => changeExpense(db, id, input));
  notifyDataChanged();
}

/**
 * Soft delete: the row stays as a "tombstone" so a future sync can tell other devices about it.
 * The money goes back to the account or card it was paid with.
 */
export async function deleteExpense(db: Db, id: string): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    const before = await getExpense(db, id);
    if (!before) return;
    await db.runAsync('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    await moveBalance(db, before.paymentAccountId, before.amountCents, now);
  });
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
            e.payment_account_id, c.name AS category_name
     FROM expenses e JOIN categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL AND e.for_whom <> e.paid_by
     ORDER BY e.spent_on DESC, e.created_at DESC`,
    [],
  );
  return rows.map((r) => ({ ...toExpense(r), categoryName: r.category_name }));
}

/**
 * Saves one purchase that belongs to two categories as two expenses: `input` keeps its category
 * with the amount minus the part, and the part goes to `part.categoryId` with the same date,
 * note and payer, and its own "for" when given. Updates `id` when given, otherwise adds a new expense.
 * Both are written in one transaction, so a purchase is never half saved.
 * Returns the id of the expense created for the part.
 */
export async function saveExpenseWithPart(
  db: Db,
  id: string | null,
  input: ExpenseInput,
  part: { categoryId: string; amountCents: number; forWhom?: ForWhom },
): Promise<string> {
  const main = { ...input, amountCents: input.amountCents - part.amountCents };
  const other = {
    ...input,
    categoryId: part.categoryId,
    amountCents: part.amountCents,
    // The part can be for someone else than the rest: shared groceries, clothes only for one.
    forWhom: part.forWhom ?? input.forWhom,
  };
  let partId = '';
  await db.withTransactionAsync(async () => {
    if (id) await changeExpense(db, id, main);
    else await insertExpense(db, main);
    partId = await insertExpense(db, other);
  });
  notifyDataChanged();
  return partId;
}
