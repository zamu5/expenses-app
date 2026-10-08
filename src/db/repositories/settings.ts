import { DEFAULT_OWNER_SHARE_PCT, type Person } from '@/domain/split';
import { nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db } from '../types';

/** The names shown for the two people. The database only stores the ids. */
export type PeopleNames = Record<Person, string>;

/** Used until names are typed in Settings. Person 1 is the owner of the budget. */
export const DEFAULT_PEOPLE_NAMES: PeopleNames = { sergio: 'Person 1', adriana: 'Person 2' };

const NAME_KEYS: Record<Person, string> = {
  sergio: 'person_name_sergio',
  adriana: 'person_name_adriana',
};

export async function getPeopleNames(db: Db): Promise<PeopleNames> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM settings WHERE key IN (?, ?)',
    [NAME_KEYS.sergio, NAME_KEYS.adriana],
  );
  const saved = (person: Person) => rows.find((r) => r.key === NAME_KEYS[person])?.value;
  return {
    sergio: saved('sergio') ?? DEFAULT_PEOPLE_NAMES.sergio,
    adriana: saved('adriana') ?? DEFAULT_PEOPLE_NAMES.adriana,
  };
}

/** Saves the two names. An empty name goes back to the default. */
export async function setPeopleNames(db: Db, names: PeopleNames): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    for (const person of ['sergio', 'adriana'] as const) {
      const name = names[person].trim();
      if (name === '') {
        await db.runAsync('DELETE FROM settings WHERE key = ?', [NAME_KEYS[person]]);
      } else {
        await db.runAsync(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [NAME_KEYS[person], name, now],
        );
      }
    }
  });
  notifyDataChanged();
}

const OWNER_SHARE_KEY = 'owner_share_pct';

/** The budget owner's share of a new shared expense, in percent. 50 until it is changed. */
export async function getOwnerSharePct(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    OWNER_SHARE_KEY,
  ]);
  const pct = row ? Number(row.value) : NaN;
  return Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : DEFAULT_OWNER_SHARE_PCT;
}

/** Changes the share used for expenses logged from now on. Past expenses keep their own. */
export async function setOwnerSharePct(db: Db, pct: number): Promise<void> {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error('The share must be 0 to 100');
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [OWNER_SHARE_KEY, String(pct), nowISO()],
  );
  notifyDataChanged();
}
