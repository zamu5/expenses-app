import type { MonthKey } from '@/domain/dates';
import { DEFAULT_OWNER_SHARE_PCT, type ForWhom } from '@/domain/split';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db, Income } from '../types';

interface IncomeRow {
  id: string;
  amount_cents: number;
  received_on: string;
  note: string | null;
  category_id: string | null;
  for_whom: ForWhom;
  account_id: string | null;
  owner_share_pct: number;
}

const toIncome = (r: IncomeRow): Income => ({
  id: r.id,
  amountCents: r.amount_cents,
  receivedOn: r.received_on,
  note: r.note,
  categoryId: r.category_id,
  forWhom: r.for_whom,
  accountId: r.account_id,
  ownerSharePct: r.owner_share_pct,
});

const COLUMNS = 'id, amount_cents, received_on, note, category_id, for_whom, account_id, owner_share_pct';

export interface IncomeInput {
  amountCents: number;
  receivedOn: string;
  note?: string | null;
  /** Makes it a refund for that category (see Income.categoryId). */
  categoryId?: string | null;
  /** For a refund: whose spending it gives back. Defaults to the budget owner. */
  forWhom?: ForWhom;
  /** The account the money went into. Its balance goes up by the amount. */
  accountId?: string | null;
  /** The owner's share of a shared refund, 0-100. Left out: half and half, or what it had. */
  ownerSharePct?: number;
}

const cleanNote = (note?: string | null) => (note?.trim() ? note.trim() : null);

/** Moves an account's balance by `deltaCents`. This is how an income shows up in the Accounts tab. */
async function deposit(db: Db, accountId: string | null, deltaCents: number, now: string): Promise<void> {
  if (!accountId || deltaCents === 0) return;
  await db.runAsync('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?', [
    deltaCents,
    now,
    accountId,
  ]);
}

export async function addIncome(db: Db, input: IncomeInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO incomes
         (id, amount_cents, received_on, note, category_id, for_whom, account_id, owner_share_pct,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.amountCents,
        input.receivedOn,
        cleanNote(input.note),
        input.categoryId ?? null,
        input.forWhom ?? 'sergio',
        input.accountId ?? null,
        input.ownerSharePct ?? DEFAULT_OWNER_SHARE_PCT,
        now,
        now,
      ],
    );
    await deposit(db, input.accountId ?? null, input.amountCents, now);
  });
  notifyDataChanged();
  return id;
}

/** Saves the changes and moves the money with them: out of the old account, into the new one. */
export async function updateIncome(db: Db, id: string, input: IncomeInput): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    const before = await getIncome(db, id);
    if (!before) throw new Error('This income no longer exists');
    await db.runAsync(
      `UPDATE incomes SET amount_cents = ?, received_on = ?, note = ?, category_id = ?, for_whom = ?,
         account_id = ?, owner_share_pct = COALESCE(?, owner_share_pct), updated_at = ?
       WHERE id = ?`,
      [
        input.amountCents,
        input.receivedOn,
        cleanNote(input.note),
        input.categoryId ?? null,
        input.forWhom ?? 'sergio',
        input.accountId ?? null,
        input.ownerSharePct ?? null,
        now,
        id,
      ],
    );
    await deposit(db, before.accountId, -before.amountCents, now);
    await deposit(db, input.accountId ?? null, input.amountCents, now);
  });
  notifyDataChanged();
}

/** Soft delete, taking the money back out of the account it had been added to. */
export async function deleteIncome(db: Db, id: string): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    const before = await getIncome(db, id);
    if (!before) return;
    await db.runAsync('UPDATE incomes SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    await deposit(db, before.accountId, -before.amountCents, now);
  });
  notifyDataChanged();
}

export async function getIncome(db: Db, id: string): Promise<Income | null> {
  const row = await db.getFirstAsync<IncomeRow>(
    `SELECT ${COLUMNS} FROM incomes WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? toIncome(row) : null;
}

/** Income and refunds of one month, newest first. With a category, only that category's refunds. */
export async function listIncomes(db: Db, month: MonthKey, categoryId?: string): Promise<Income[]> {
  const rows = await db.getAllAsync<IncomeRow>(
    `SELECT ${COLUMNS} FROM incomes
     WHERE deleted_at IS NULL AND received_on LIKE ? ${categoryId ? 'AND category_id = ?' : ''}
     ORDER BY received_on DESC, created_at DESC`,
    categoryId ? [`${month}-%`, categoryId] : [`${month}-%`],
  );
  return rows.map(toIncome);
}

/** Real income of the month. Refunds are left out: they lower spending instead. */
export async function getIncomeTotal(db: Db, month: MonthKey): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount_cents) AS total FROM incomes
     WHERE deleted_at IS NULL AND category_id IS NULL AND received_on LIKE ?`,
    [`${month}-%`],
  );
  return row?.total ?? 0;
}
