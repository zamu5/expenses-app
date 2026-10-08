import type { MonthKey } from '@/domain/dates';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db, Income } from '../types';

interface IncomeRow {
  id: string;
  amount_cents: number;
  received_on: string;
  note: string | null;
}

const toIncome = (r: IncomeRow): Income => ({
  id: r.id,
  amountCents: r.amount_cents,
  receivedOn: r.received_on,
  note: r.note,
});

const COLUMNS = 'id, amount_cents, received_on, note';

export interface IncomeInput {
  amountCents: number;
  receivedOn: string;
  note?: string | null;
}

const cleanNote = (note?: string | null) => (note?.trim() ? note.trim() : null);

export async function addIncome(db: Db, input: IncomeInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.runAsync(
    `INSERT INTO incomes (id, amount_cents, received_on, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.amountCents, input.receivedOn, cleanNote(input.note), now, now],
  );
  notifyDataChanged();
  return id;
}

export async function updateIncome(db: Db, id: string, input: IncomeInput): Promise<void> {
  await db.runAsync(
    'UPDATE incomes SET amount_cents = ?, received_on = ?, note = ?, updated_at = ? WHERE id = ?',
    [input.amountCents, input.receivedOn, cleanNote(input.note), nowISO(), id],
  );
  notifyDataChanged();
}

export async function deleteIncome(db: Db, id: string): Promise<void> {
  const now = nowISO();
  await db.runAsync('UPDATE incomes SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  notifyDataChanged();
}

export async function getIncome(db: Db, id: string): Promise<Income | null> {
  const row = await db.getFirstAsync<IncomeRow>(
    `SELECT ${COLUMNS} FROM incomes WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? toIncome(row) : null;
}

/** Income of one month, newest first. */
export async function listIncomes(db: Db, month: MonthKey): Promise<Income[]> {
  const rows = await db.getAllAsync<IncomeRow>(
    `SELECT ${COLUMNS} FROM incomes WHERE deleted_at IS NULL AND received_on LIKE ?
     ORDER BY received_on DESC, created_at DESC`,
    [`${month}-%`],
  );
  return rows.map(toIncome);
}

export async function getIncomeTotal(db: Db, month: MonthKey): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount_cents) AS total FROM incomes WHERE deleted_at IS NULL AND received_on LIKE ?',
    [`${month}-%`],
  );
  return row?.total ?? 0;
}
