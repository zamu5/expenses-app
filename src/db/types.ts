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
  startingBalanceCents: number;
}

export interface Expense {
  id: string;
  categoryId: string;
  amountCents: number;
  spentOn: string;
  note: string | null;
  paidBy: Person;
  forWhom: ForWhom;
}

/** Money received: a salary, a refund. It raises the month's balance; it is not a negative expense. */
export interface Income {
  id: string;
  amountCents: number;
  receivedOn: string;
  note: string | null;
}

export type AccountKind = 'account' | 'planned';

/**
 * Somewhere money is (kind 'account'), or an expense you expect but have not tied to a month
 * (kind 'planned': typed as a positive amount, counted as negative in the totals).
 */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** ISO 4217 code, e.g. 'CAD' or 'COP'. */
  currency: string;
  balanceCents: number;
  /** The one account the monthly budget lives in. Its balance comes from the budget, not from typing. */
  isBudgetAccount: boolean;
  /**
   * Whether this account counts toward "Started with" on the Month tab. The budget account always
   * does (through the month's own starting balance) and planned expenses always subtract.
   */
  includeInStart: boolean;
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
