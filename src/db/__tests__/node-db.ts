import { DatabaseSync } from 'node:sqlite';

import type { Db } from '../types';

/**
 * Test-only adapter: runs the app's real SQL against Node's built-in SQLite, in memory.
 * Same SQL engine as the phone, so the repositories are tested for real, without a device.
 */
export function createTestDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  const toParams = (params: unknown[]) =>
    params.map((p) => (typeof p === 'boolean' ? Number(p) : p)) as (string | number | null)[];

  return {
    async execAsync(source) {
      sqlite.exec(source);
    },
    async runAsync(source, params) {
      return sqlite.prepare(source).run(...toParams(params));
    },
    async getAllAsync<T>(source: string, params: unknown[]) {
      return sqlite.prepare(source).all(...toParams(params)) as T[];
    },
    async getFirstAsync<T>(source: string, params: unknown[]) {
      return (sqlite.prepare(source).get(...toParams(params)) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
