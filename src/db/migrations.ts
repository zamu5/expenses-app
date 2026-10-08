import { newId, nowISO } from '@/lib/id';

import type { Db } from './types';

/**
 * Each migration moves the schema one version forward. SQLite stores the current version in
 * `PRAGMA user_version`, so on every launch we run only the migrations the phone has not seen yet.
 * Never edit a migration that has shipped: add a new one instead.
 */
const migrations: ((db: Db) => Promise<void>)[] = [
  // Version 1: the initial schema.
  async (db) => {
    await db.execAsync(`
      CREATE TABLE months (
        id TEXT PRIMARY KEY NOT NULL,
        month_key TEXT NOT NULL UNIQUE,
        starting_balance_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        is_fixed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE category_budgets (
        id TEXT PRIMARY KEY NOT NULL,
        month_id TEXT NOT NULL REFERENCES months(id),
        category_id TEXT NOT NULL REFERENCES categories(id),
        amount_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE UNIQUE INDEX budget_month_category ON category_budgets (month_id, category_id);

      CREATE TABLE expenses (
        id TEXT PRIMARY KEY NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        spent_on TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX expenses_spent_on ON expenses (spent_on);
      CREATE INDEX expenses_category ON expenses (category_id);
    `);

    // Starter categories so the app is useful on first launch. Rename or archive them freely.
    const starters: [string, boolean][] = [
      ['Rent', true],
      ['Utilities', true],
      ['Groceries', false],
      ['Transport', false],
      ['Eating out', false],
      ['Fun', false],
    ];
    const now = nowISO();
    for (const [index, [name, isFixed]] of starters.entries()) {
      await db.runAsync(
        `INSERT INTO categories (id, name, is_fixed, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), name, isFixed ? 1 : 0, index, now, now],
      );
    }
  },

  // Version 2: categories that are not monthly, who paid each expense and who it was for,
  // and the payments the two people make to each other to settle up.
  async (db) => {
    await db.execAsync(`
      ALTER TABLE categories ADD COLUMN is_monthly INTEGER NOT NULL DEFAULT 1;

      -- Expenses logged before this version count as paid by Sergio and shared 50/50.
      ALTER TABLE expenses ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'sergio'
        CHECK (paid_by IN ('sergio', 'adriana'));
      ALTER TABLE expenses ADD COLUMN for_whom TEXT NOT NULL DEFAULT 'shared'
        CHECK (for_whom IN ('shared', 'sergio', 'adriana'));

      CREATE TABLE settlements (
        id TEXT PRIMARY KEY NOT NULL,
        from_person TEXT NOT NULL CHECK (from_person IN ('sergio', 'adriana')),
        to_person TEXT NOT NULL CHECK (to_person IN ('sergio', 'adriana')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        settled_on TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CHECK (from_person <> to_person)
      );
    `);
  },

  // Version 3: income, and the accounts / planned expenses behind the Accounts tab.
  async (db) => {
    await db.execAsync(`
      CREATE TABLE incomes (
        id TEXT PRIMARY KEY NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        received_on TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX incomes_received_on ON incomes (received_on);

      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('account', 'planned')),
        currency TEXT NOT NULL,
        balance_cents INTEGER NOT NULL DEFAULT 0,
        is_budget_account INTEGER NOT NULL DEFAULT 0,
        balance_updated_on TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE exchange_rates (
        currency TEXT PRIMARY KEY NOT NULL,
        units_per_home REAL NOT NULL CHECK (units_per_home > 0),
        set_on TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },

  // Version 4: small facts about this device, like when the last backup was made.
  // They are not part of a backup.
  async (db) => {
    await db.execAsync(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
];

export const LATEST_SCHEMA_VERSION = migrations.length;

export async function migrate(db: Db): Promise<void> {
  // WAL makes reads and writes not block each other; foreign keys are off by default in SQLite.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;

  while (version < migrations.length) {
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await migrations[version](db);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
