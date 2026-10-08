import {
  BACKUP_TABLES,
  backupFileName,
  buildBackup,
  parseBackup,
  summarizeBackup,
  type BackupRow,
  type BackupTable,
} from './backup';

const empty = () =>
  Object.fromEntries(BACKUP_TABLES.map((t) => [t, [] as BackupRow[]])) as Record<BackupTable, BackupRow[]>;

const sample = () =>
  buildBackup(
    {
      ...empty(),
      categories: [{ id: 'c1', name: 'Rent', deleted_at: null }],
      expenses: [
        { id: 'e1', category_id: 'c1', amount_cents: 1200, deleted_at: null },
        { id: 'e2', category_id: 'c1', amount_cents: 500, deleted_at: '2026-10-02T00:00:00.000Z' },
      ],
    },
    3,
    '2026-10-07T12:00:00.000Z',
  );

describe('parseBackup', () => {
  it('reads back what buildBackup made', () => {
    const result = parseBackup(JSON.stringify(sample()), 3);
    expect(result).toEqual({ ok: true, backup: sample() });
  });

  it('accepts a backup from an older schema, with newer tables missing', () => {
    const old = JSON.parse(JSON.stringify(sample()));
    old.schemaVersion = 1;
    delete old.tables.incomes;
    delete old.tables.accounts;
    const result = parseBackup(JSON.stringify(old), 3);
    expect(result.ok && result.backup.tables.incomes).toEqual([]);
  });

  it.each([
    ['not json', 'hello'],
    ['json that is not an object', '42'],
    ['another app', JSON.stringify({ ...sample(), app: 'something-else' })],
    ['an unknown format', JSON.stringify({ ...sample(), format: 99 })],
    ['a newer schema than the app', JSON.stringify({ ...sample(), schemaVersion: 4 })],
    ['a missing export date', JSON.stringify({ ...sample(), exportedAt: 'yesterday-ish' })],
    ['no tables', JSON.stringify({ ...sample(), tables: undefined })],
    ['a missing required table', JSON.stringify({ ...sample(), tables: { ...sample().tables, expenses: undefined } })],
    ['rows that are not rows', JSON.stringify({ ...sample(), tables: { ...sample().tables, expenses: [[1, 2]] } })],
    ['nested values in a row', JSON.stringify({ ...sample(), tables: { ...sample().tables, expenses: [{ id: { a: 1 } }] } })],
  ])('refuses %s', (_name, text) => {
    const result = parseBackup(text, 3);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\w/);
  });
});

describe('summarizeBackup', () => {
  it('counts what you would see after restoring, skipping deleted rows', () => {
    const summary = summarizeBackup(sample());
    expect(summary.exportedAt).toBe('2026-10-07T12:00:00.000Z');
    expect(summary.counts.find((c) => c.label === 'Expenses')?.count).toBe(1);
    expect(summary.counts.find((c) => c.label === 'Categories')?.count).toBe(1);
    expect(summary.counts).toHaveLength(BACKUP_TABLES.length);
  });
});

describe('backupFileName', () => {
  it('carries the day', () => {
    expect(backupFileName('2026-10-07')).toBe('expenses-backup-2026-10-07.json');
  });
});
