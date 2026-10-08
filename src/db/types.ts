import type { SQLiteBindValue } from 'expo-sqlite';

import type { ForWhom, Person } from '@/domain/split';

/**
 * The slice of the database API the app uses.
 * expo-sqlite's SQLiteDatabase satisfies it on the phone; tests plug in Node's built-in SQLite instead.
 */
export interface Db {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SQLiteBindValue[]): Promise<unknown>;
  getAllAsync<T>(source: string, params: SQLiteBindValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SQLiteBindValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export interface Category {
  id: string;
  name: string;
  isFixed: boolean;
  /** Monthly categories are in every month's plan; the others only in the months you add them to. */
  isMonthly: boolean;
  sortOrder: number;
  archivedAt: string | null;
}

export interface Month {
  id: string;
  monthKey: string;
  /** No longer used: what a month starts with now comes from the accounts. Kept for old data. */
  startingBalanceCents: number;
  /** Income the plan expects this month, e.g. the salary. 0 when none was set. */
  expectedIncomeCents: number;
}

export interface Expense {
  id: string;
  categoryId: string;
  amountCents: number;
  spentOn: string;
  note: string | null;
  paidBy: Person;
  forWhom: ForWhom;
  /** The account or credit card it was paid with, whose balance it lowered. Null when not tracked. */
  paymentAccountId: string | null;
}

/** Money received: a salary, a refund. It raises the month's balance; it is not a negative expense. */
export interface Income {
  id: string;
  amountCents: number;
  receivedOn: string;
  note: string | null;
  /**
   * Set for a refund: the category whose spending this money gives back. A refund lowers that
   * category's spending and is not counted as income.
   */
  categoryId: string | null;
  /** For a refund: whose spending it gives back. Shared means half of it belongs to the other person. */
  forWhom: ForWhom;
  /** The account the money went into, whose balance it was added to. Null when none was picked. */
  accountId: string | null;
}

export type AccountKind = 'account' | 'planned';
/** A bank account is money you pay with; an investment account is money put aside. */
export type AccountType = 'bank' | 'investment';

/**
 * Somewhere money is (kind 'account'), or an expense you expect but have not tied to a month
 * (kind 'planned': typed as a positive amount, counted as negative in the totals).
 */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Only meaningful for kind 'account'. Credit cards are bank accounts with a linked account. */
  accountType: AccountType;
  /** ISO 4217 code, e.g. 'CAD' or 'COP'. */
  currency: string;
  balanceCents: number;
  /** Whether this account counts toward "Started with" on the Month tab. Planned expenses always subtract. */
  includeInStart: boolean;
  /** The account pre-selected when logging an income. At most one. */
  isIncomeDefault: boolean;
  /**
   * Set on a credit card: the bank account it is paid from. A card's balance is negative,
   * because it is money owed.
   */
  linkedAccountId: string | null;
  /** The account or card pre-selected as "Paid with" on a new expense. At most one. */
  isPaymentDefault: boolean;
  /** Day the balance was last typed in. */
  balanceUpdatedOn: string;
}

/** How many units of `currency` one unit of the home currency buys, e.g. 1 CAD = 2950 COP. */
export interface ExchangeRate {
  currency: string;
  unitsPerHome: number;
  setOn: string;
}

/** Money one person handed to the other to pay back what they owed. */
export interface Settlement {
  id: string;
  fromPerson: Person;
  toPerson: Person;
  amountCents: number;
  settledOn: string;
}
