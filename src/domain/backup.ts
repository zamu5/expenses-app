/**
 * The backup file format, as pure functions: building it, checking a file someone picked,
 * and describing what is inside. Reading and writing the database lives in the repository.
 */

export const BACKUP_APP = 'expenses-app';
export const BACKUP_FORMAT = 1;

/** Every table in a backup, in an order that satisfies foreign keys when rows are inserted. */
export const BACKUP_TABLES = [
  'months',
  'categories',
  'category_budgets',
  'expenses',
  'accounts',
  'incomes',
  'settlements',
  'exchange_rates',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupRow = Record<string, string | number | null>;

export interface Backup {
  app: typeof BACKUP_APP;
  format: number;
  /** Database schema version (PRAGMA user_version) the rows were exported from. */
  schemaVersion: number;
  /** ISO timestamp of the export. */
  exportedAt: string;
  tables: Record<BackupTable, BackupRow[]>;
}

/** Tables that exist since schema version 1. Newer ones may be missing from an old backup. */
const REQUIRED_TABLES: BackupTable[] = ['months', 'categories', 'category_budgets', 'expenses'];

export function buildBackup(
  tables: Record<BackupTable, BackupRow[]>,
  schemaVersion: number,
  exportedAt: string,
): Backup {
  return { app: BACKUP_APP, format: BACKUP_FORMAT, schemaVersion, exportedAt, tables };
}

/** 'expenses-backup-2026-10-07.json' */
export function backupFileName(day: string): string {
  return `expenses-backup-${day}.json`;
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: string };

const isRow = (value: unknown): value is BackupRow =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => v === null || typeof v === 'string' || typeof v === 'number');

/**
 * Checks the text of a picked file. Nothing is restored unless this says ok, so a wrong or
 * damaged file can never replace real data. `appSchemaVersion` is the newest schema this app knows.
 */
export function parseBackup(text: string, appSchemaVersion: number): ParsedBackup {
  const fail = (error: string): ParsedBackup => ({ ok: false, error });

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('This file is not a backup: it could not be read as JSON.');
  }
  if (typeof data !== 'object' || data === null) return fail('This file is not a backup.');
  const file = data as Record<string, unknown>;

  if (file.app !== BACKUP_APP) return fail('This file is not a backup made by this app.');
  if (file.format !== BACKUP_FORMAT) {
    return fail('This backup uses a format this version of the app cannot read.');
  }
  if (typeof file.schemaVersion !== 'number' || !Number.isInteger(file.schemaVersion) || file.schemaVersion < 1) {
    return fail('This backup does not say which version of the data it holds.');
  }
  if (file.schemaVersion > appSchemaVersion) {
    return fail('This backup was made by a newer version of the app. Update the app, then restore it.');
  }
  if (typeof file.exportedAt !== 'string' || Number.isNaN(Date.parse(file.exportedAt))) {
    return fail('This backup does not say when it was made.');
  }
  if (typeof file.tables !== 'object' || file.tables === null) return fail('This backup holds no data.');

  const source = file.tables as Record<string, unknown>;
  const tables = {} as Record<BackupTable, BackupRow[]>;
  for (const table of BACKUP_TABLES) {
    const rows = source[table];
    if (rows === undefined && !REQUIRED_TABLES.includes(table)) {
      tables[table] = [];
      continue;
    }
    if (!Array.isArray(rows) || !rows.every(isRow)) {
      return fail(`This backup is damaged: its "${table}" data cannot be read.`);
    }
    tables[table] = rows;
  }

  return {
    ok: true,
    backup: buildBackup(tables, file.schemaVersion, file.exportedAt),
  };
}

export interface BackupSummary {
  exportedAt: string;
  /** Rows that are not soft-deleted, i.e. what you would see in the app after restoring. */
  counts: { label: string; count: number }[];
}

const LABELS: Record<BackupTable, string> = {
  months: 'Planned months',
  categories: 'Categories',
  category_budgets: 'Budgets',
  expenses: 'Expenses',
  incomes: 'Incomes',
  settlements: 'Payments between you two',
  accounts: 'Accounts and planned expenses',
  exchange_rates: 'Exchange rates',
};

export function summarizeBackup(backup: Backup): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    counts: BACKUP_TABLES.map((table) => ({
      label: LABELS[table],
      count: backup.tables[table].filter((row) => row.deleted_at == null).length,
    })),
  };
}
