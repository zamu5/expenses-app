import type { SQLiteBindValue } from 'expo-sqlite';

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
}
