import { BACKUP_TABLES, buildBackup, type Backup, type BackupRow, type BackupTable } from '@/domain/backup';
import { nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import { getPeopleNames, setPeopleNames } from './settings';
import type { Db } from '../types';

const LAST_BACKUP_KEY = 'last_backup_at';

/** Reads every row of every table, deleted ones included, so a restore is an exact copy. */
export async function exportBackup(db: Db): Promise<Backup> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const tables = {} as Record<BackupTable, BackupRow[]>;
  for (const table of BACKUP_TABLES) {
    tables[table] = await db.getAllAsync<BackupRow>(`SELECT * FROM ${table}`, []);
  }
  return buildBackup(tables, version?.user_version ?? 0, nowISO(), { ...(await getPeopleNames(db)) });
}

/**
 * Replaces ALL data with the backup, in one transaction: if any row fails, nothing changes.
 * Pass a backup that parseBackup() accepted. Columns the backup does not have (it came from an
 * older version of the app) get their default value, which is what the migrations would have done.
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<void> {
  await db.withTransactionAsync(async () => {
    // A credit card points at another row of its own table, which may come later in the file.
    // Checking foreign keys once at the end of the transaction makes the row order irrelevant.
    await db.execAsync('PRAGMA defer_foreign_keys = ON');
    // Children first, so no row is deleted while another still points at it.
    for (const table of [...BACKUP_TABLES].reverse()) {
      await db.runAsync(`DELETE FROM ${table}`, []);
    }
    for (const table of BACKUP_TABLES) {
      const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`, []);
      const known = new Set(info.map((c) => c.name));
      for (const row of backup.tables[table]) {
        const columns = Object.keys(row).filter((c) => known.has(c));
        if (columns.length === 0) continue;
        await db.runAsync(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((c) => row[c]),
        );
      }
    }
  });
  // The names travel with the data. A backup from before they were a setting has none, and the
  // names on this device are then left as they are.
  if (backup.people?.sergio && backup.people?.adriana) {
    await setPeopleNames(db, { sergio: backup.people.sergio, adriana: backup.people.adriana });
  }
  notifyDataChanged();
}

/** When the last backup file was exported from this device, or null if never. */
export async function getLastBackupAt(db: Db): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    LAST_BACKUP_KEY,
  ]);
  return row?.value ?? null;
}

export async function setLastBackupAt(db: Db, at: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [LAST_BACKUP_KEY, at, nowISO()],
  );
  notifyDataChanged();
}
