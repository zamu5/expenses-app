import { BUDGET_OWNER } from '@/domain/split';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Account, AccountKind, AccountType, Db, ExchangeRate } from '../types';

interface AccountRow {
  id: string;
  name: string;
  kind: AccountKind;
  account_type: AccountType;
  currency: string;
  balance_cents: number;
  is_income_default: number;
  linked_account_id: string | null;
  is_payment_default: number;
  balance_updated_on: string;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  accountType: r.account_type,
  currency: r.currency,
  balanceCents: r.balance_cents,
  isIncomeDefault: r.is_income_default === 1,
  linkedAccountId: r.linked_account_id,
  isPaymentDefault: r.is_payment_default === 1,
  balanceUpdatedOn: r.balance_updated_on,
});

const COLUMNS =
  'id, name, kind, account_type, currency, balance_cents, is_income_default, linked_account_id, is_payment_default, balance_updated_on';

/** Accounts first, then planned expenses, each in the order they were added. */
export async function listAccounts(db: Db): Promise<Account[]> {
  const rows = await db.getAllAsync<AccountRow>(
    `SELECT ${COLUMNS} FROM accounts WHERE deleted_at IS NULL
     ORDER BY kind, sort_order, name`,
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
  /** Defaults to 'bank'. An investment account cannot be a credit card or a payment method. */
  accountType?: AccountType;
  currency: string;
  balanceCents: number;
  /** Pre-select this account when logging an income. Turning it on turns it off elsewhere. */
  isIncomeDefault?: boolean;
  /** Makes it a credit card paid from that account. Its balance is negative while money is owed on it. */
  linkedAccountId?: string | null;
  /** Pre-select it as "Paid with" on new expenses. Turning it on turns it off elsewhere. */
  isPaymentDefault?: boolean;
  /** Day the balance was typed, 'YYYY-MM-DD'. */
  balanceUpdatedOn: string;
}

/** Applies the rules between the options: only a bank account can be a card or pay for things. */
function normalize(input: AccountInput) {
  const isAccount = input.kind === 'account';
  const accountType: AccountType = isAccount ? (input.accountType ?? 'bank') : 'bank';
  const isBank = isAccount && accountType === 'bank';
  const linkedAccountId = isBank ? (input.linkedAccountId ?? null) : null;
  return {
    accountType,
    linkedAccountId,
    isIncomeDefault: isAccount && linkedAccountId === null && input.isIncomeDefault === true,
    isPaymentDefault: isBank && input.isPaymentDefault === true,
  };
}

/** Only one account holds each default, so marking one unmarks the others. */
async function keepOneDefault(
  db: Db,
  column: 'is_income_default' | 'is_payment_default',
  id: string,
  now: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE accounts SET ${column} = 0, updated_at = ? WHERE ${column} = 1 AND id <> ?`,
    [now, id],
  );
}

export async function createAccount(db: Db, input: AccountInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  const { accountType, linkedAccountId, isIncomeDefault, isPaymentDefault } = normalize(input);
  await db.withTransactionAsync(async () => {
    const firstCard =
      linkedAccountId !== null &&
      (await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM accounts WHERE linked_account_id IS NOT NULL AND deleted_at IS NULL LIMIT 1',
        [],
      )) === null;
    await db.runAsync(
      `INSERT INTO accounts
         (id, name, kind, account_type, currency, balance_cents, is_income_default,
          linked_account_id, is_payment_default, balance_updated_on, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts), ?, ?)`,
      [
        id,
        input.name.trim(),
        input.kind,
        accountType,
        input.currency,
        input.balanceCents,
        isIncomeDefault ? 1 : 0,
        linkedAccountId,
        isPaymentDefault ? 1 : 0,
        input.balanceUpdatedOn,
        now,
        now,
      ],
    );
    if (isIncomeDefault) await keepOneDefault(db, 'is_income_default', id, now);
    if (isPaymentDefault) await keepOneDefault(db, 'is_payment_default', id, now);
    // Expenses logged before cards existed are taken to have been paid with the first card.
    // They are only tagged: the balance typed for the card already includes them.
    if (firstCard) {
      await db.runAsync(
        'UPDATE expenses SET payment_account_id = ?, updated_at = ? WHERE payment_account_id IS NULL AND paid_by = ?',
        [id, now, BUDGET_OWNER],
      );
    }
  });
  notifyDataChanged();
  return id;
}

export async function updateAccount(db: Db, id: string, input: AccountInput): Promise<void> {
  const now = nowISO();
  const { accountType, linkedAccountId, isIncomeDefault, isPaymentDefault } = normalize(input);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE accounts SET name = ?, account_type = ?, currency = ?, balance_cents = ?,
         is_income_default = ?, linked_account_id = ?, is_payment_default = ?,
         balance_updated_on = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name.trim(),
        accountType,
        input.currency,
        input.balanceCents,
        isIncomeDefault ? 1 : 0,
        linkedAccountId,
        isPaymentDefault ? 1 : 0,
        input.balanceUpdatedOn,
        now,
        id,
      ],
    );
    if (isIncomeDefault) await keepOneDefault(db, 'is_income_default', id, now);
    if (isPaymentDefault) await keepOneDefault(db, 'is_payment_default', id, now);
  });
  notifyDataChanged();
}

/**
 * Pays a credit card from the bank account it is linked to: the account goes down and the debt
 * on the card goes down by the same amount. Nothing else changes; it is not an expense.
 */
export async function payCard(db: Db, cardId: string, amountCents: number): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    const card = await getAccount(db, cardId);
    if (!card?.linkedAccountId) throw new Error('This is not a credit card linked to an account');
    await db.runAsync('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?', [
      amountCents,
      now,
      cardId,
    ]);
    await db.runAsync('UPDATE accounts SET balance_cents = balance_cents - ?, updated_at = ? WHERE id = ?', [
      amountCents,
      now,
      card.linkedAccountId,
    ]);
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
