import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Category, Db } from '../types';

interface CategoryRow {
  id: string;
  name: string;
  is_fixed: number;
  sort_order: number;
  archived_at: string | null;
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  isFixed: r.is_fixed === 1,
  sortOrder: r.sort_order,
  archivedAt: r.archived_at,
});

const COLUMNS = 'id, name, is_fixed, sort_order, archived_at';

export async function listCategories(
  db: Db,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<Category[]> {
  const rows = await db.getAllAsync<CategoryRow>(
    `SELECT ${COLUMNS} FROM categories
     WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
     ORDER BY archived_at IS NOT NULL, sort_order, name`,
    [],
  );
  return rows.map(toCategory);
}

export async function getCategory(db: Db, id: string): Promise<Category | null> {
  const row = await db.getFirstAsync<CategoryRow>(
    `SELECT ${COLUMNS} FROM categories WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? toCategory(row) : null;
}

export async function createCategory(
  db: Db,
  input: { name: string; isFixed: boolean },
): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.runAsync(
    `INSERT INTO categories (id, name, is_fixed, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories), ?, ?)`,
    [id, input.name.trim(), input.isFixed ? 1 : 0, now, now],
  );
  notifyDataChanged();
  return id;
}

export async function updateCategory(
  db: Db,
  id: string,
  input: { name: string; isFixed: boolean },
): Promise<void> {
  await db.runAsync(
    'UPDATE categories SET name = ?, is_fixed = ?, updated_at = ? WHERE id = ?',
    [input.name.trim(), input.isFixed ? 1 : 0, nowISO(), id],
  );
  notifyDataChanged();
}

/** Archived categories disappear from pickers but keep their past expenses and budgets intact. */
export async function setCategoryArchived(db: Db, id: string, archived: boolean): Promise<void> {
  const now = nowISO();
  await db.runAsync('UPDATE categories SET archived_at = ?, updated_at = ? WHERE id = ?', [
    archived ? now : null,
    now,
    id,
  ]);
  notifyDataChanged();
}
