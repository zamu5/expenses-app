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

/** Money one person handed to the other to pay back what they owed. */
export interface Settlement {
  id: string;
  fromPerson: Person;
  toPerson: Person;
  amountCents: number;
  settledOn: string;
}
