import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Account, AccountKind, Db, ExchangeRate } from '../types';

interface AccountRow {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  balance_cents: number;
  is_budget_account: number;
  balance_updated_on: string;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  currency: r.currency,
  balanceCents: r.balance_cents,
  isBudgetAccount: r.is_budget_account === 1,
  balanceUpdatedOn: r.balance_updated_on,
});

const COLUMNS = 'id, name, kind, currency, balance_cents, is_budget_account, balance_updated_on';

/** Accounts first, then planned expenses, each in the order they were added. */
export async function listAccounts(db: Db): Promise<Account[]> {
  const rows = await db.getAllAsync<AccountRow>(
    `SELECT ${COLUMNS} FROM accounts WHERE deleted_at IS NULL
     ORDER BY kind, is_budget_account DESC, sort_order, name`,
    [],
  );
  return rows.map(toAccount);
}

export async function getAccount(db: Db, id: string): Promise<Account | null> {
  const row = await db.getFirstAsync<AccountRow>(
    `SELECT ${COLUMNS} FROM accounts WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? toAccount(row) : null;
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  currency: string;
  balanceCents: number;
  isBudgetAccount?: boolean;
  /** Day the balance was typed, 'YYYY-MM-DD'. */
  balanceUpdatedOn: string;
}

/** Only one account can be the budget account, so marking one unmarks the others. */
async function clearBudgetAccount(db: Db, exceptId: string, now: string): Promise<void> {
  await db.runAsync(
    'UPDATE accounts SET is_budget_account = 0, updated_at = ? WHERE is_budget_account = 1 AND id <> ?',
    [now, exceptId],
  );
}

export async function createAccount(db: Db, input: AccountInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  const isBudget = input.kind === 'account' && input.isBudgetAccount === true;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO accounts
         (id, name, kind, currency, balance_cents, is_budget_account, balance_updated_on,
          sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts), ?, ?)`,
      [
        id,
        input.name.trim(),
        input.kind,
        input.currency,
        input.balanceCents,
        isBudget ? 1 : 0,
        input.balanceUpdatedOn,
        now,
        now,
      ],
    );
    if (isBudget) await clearBudgetAccount(db, id, now);
  });
  notifyDataChanged();
  return id;
}

export async function updateAccount(db: Db, id: string, input: AccountInput): Promise<void> {
  const now = nowISO();
  const isBudget = input.kind === 'account' && input.isBudgetAccount === true;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE accounts SET name = ?, currency = ?, balance_cents = ?, is_budget_account = ?,
         balance_updated_on = ?, updated_at = ?
       WHERE id = ?`,
      [input.name.trim(), input.currency, input.balanceCents, isBudget ? 1 : 0, input.balanceUpdatedOn, now, id],
    );
    if (isBudget) await clearBudgetAccount(db, id, now);
  });
  notifyDataChanged();
}

export async function deleteAccount(db: Db, id: string): Promise<void> {
  const now = nowISO();
  await db.runAsync('UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  notifyDataChanged();
}

export async function listExchangeRates(db: Db): Promise<ExchangeRate[]> {
  const rows = await db.getAllAsync<{ currency: string; units_per_home: number; set_on: string }>(
    'SELECT currency, units_per_home, set_on FROM exchange_rates ORDER BY currency',
    [],
  );
  return rows.map((r) => ({ currency: r.currency, unitsPerHome: r.units_per_home, setOn: r.set_on }));
}

/** Sets how many units of `currency` one unit of the home currency buys. */
export async function setExchangeRate(
  db: Db,
  input: { currency: string; unitsPerHome: number; setOn: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO exchange_rates (currency, units_per_home, set_on, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (currency) DO UPDATE SET
       units_per_home = excluded.units_per_home,
       set_on = excluded.set_on,
       updated_at = excluded.updated_at`,
    [input.currency, input.unitsPerHome, input.setOn, nowISO()],
  );
  notifyDataChanged();
}
