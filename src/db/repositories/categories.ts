import type { MonthKey } from '@/domain/dates';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Category, Db } from '../types';

interface CategoryRow {
  id: string;
  name: string;
  is_fixed: number;
  is_monthly: number;
  sort_order: number;
  archived_at: string | null;
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  isFixed: r.is_fixed === 1,
  isMonthly: r.is_monthly === 1,
  sortOrder: r.sort_order,
  archivedAt: r.archived_at,
});

const COLUMNS = 'id, name, is_fixed, is_monthly, sort_order, archived_at';

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

/**
 * The active categories that belong to one month's plan. A budget row puts a category in the month
 * and a soft-deleted budget row takes it out; with no row at all, monthly categories are in.
 */
export async function listCategoriesForMonth(db: Db, month: MonthKey): Promise<Category[]> {
  const rows = await db.getAllAsync<CategoryRow>(
    `SELECT c.id, c.name, c.is_fixed, c.is_monthly, c.sort_order, c.archived_at
     FROM categories c
     LEFT JOIN (
       SELECT b.category_id, b.deleted_at FROM category_budgets b
       JOIN months m ON m.id = b.month_id
       WHERE m.month_key = ?
     ) b ON b.category_id = c.id
     WHERE c.deleted_at IS NULL AND c.archived_at IS NULL
       AND ((b.category_id IS NOT NULL AND b.deleted_at IS NULL)
         OR (b.category_id IS NULL AND c.is_monthly = 1))
     ORDER BY c.sort_order, c.name`,
    [month],
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

export interface CategoryInput {
  name: string;
  isFixed: boolean;
  /** Defaults to true: the category is part of every month. */
  isMonthly?: boolean;
}

export async function createCategory(db: Db, input: CategoryInput): Promise<string> {
  const id = newId();
  const now = nowISO();
  await db.runAsync(
    `INSERT INTO categories (id, name, is_fixed, is_monthly, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories), ?, ?)`,
    [id, input.name.trim(), input.isFixed ? 1 : 0, (input.isMonthly ?? true) ? 1 : 0, now, now],
  );
  notifyDataChanged();
  return id;
}

export async function updateCategory(db: Db, id: string, input: CategoryInput): Promise<void> {
  await db.runAsync(
    'UPDATE categories SET name = ?, is_fixed = ?, is_monthly = ?, updated_at = ? WHERE id = ?',
    [input.name.trim(), input.isFixed ? 1 : 0, (input.isMonthly ?? true) ? 1 : 0, nowISO(), id],
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
