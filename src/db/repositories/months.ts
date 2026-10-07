import type { CategoryInput } from '@/domain/budget';
import type { MonthKey } from '@/domain/dates';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db, Month } from '../types';

interface MonthRow {
  id: string;
  month_key: string;
  starting_balance_cents: number;
}

export async function getMonth(db: Db, month: MonthKey): Promise<Month | null> {
  const row = await db.getFirstAsync<MonthRow>(
    `SELECT id, month_key, starting_balance_cents FROM months
     WHERE month_key = ? AND deleted_at IS NULL`,
    [month],
  );
  return row
    ? { id: row.id, monthKey: row.month_key, startingBalanceCents: row.starting_balance_cents }
    : null;
}

/** Budgets of one month as { categoryId: amountCents }. */
export async function getBudgets(db: Db, month: MonthKey): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ category_id: string; amount_cents: number }>(
    `SELECT b.category_id, b.amount_cents FROM category_budgets b
     JOIN months m ON m.id = b.month_id
     WHERE m.month_key = ? AND b.deleted_at IS NULL`,
    [month],
  );
  return Object.fromEntries(rows.map((r) => [r.category_id, r.amount_cents]));
}

/** The most recent month planned before `month`, used to pre-fill a new month's plan. */
export async function getPreviousPlan(
  db: Db,
  month: MonthKey,
): Promise<{ month: Month; budgets: Record<string, number> } | null> {
  const row = await db.getFirstAsync<{ month_key: string }>(
    `SELECT month_key FROM months WHERE month_key < ? AND deleted_at IS NULL
     ORDER BY month_key DESC LIMIT 1`,
    [month],
  );
  if (!row) return null;
  const previous = await getMonth(db, row.month_key);
  return previous ? { month: previous, budgets: await getBudgets(db, row.month_key) } : null;
}

export interface MonthPlan {
  month: MonthKey;
  startingBalanceCents: number;
  budgets: { categoryId: string; amountCents: number }[];
}

/** Creates or updates a month and all its budgets in one transaction: all of it is saved, or none. */
export async function saveMonthPlan(db: Db, plan: MonthPlan): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO months (id, month_key, starting_balance_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (month_key) DO UPDATE SET
         starting_balance_cents = excluded.starting_balance_cents,
         updated_at = excluded.updated_at`,
      [newId(), plan.month, plan.startingBalanceCents, now, now],
    );
    const month = await getMonth(db, plan.month);
    if (!month) throw new Error(`Month ${plan.month} was not saved`);

    for (const b of plan.budgets) {
      await db.runAsync(
        `INSERT INTO category_budgets (id, month_id, category_id, amount_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (month_id, category_id) DO UPDATE SET
           amount_cents = excluded.amount_cents,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
        [newId(), month.id, b.categoryId, b.amountCents, now, now],
      );
    }
  });
  notifyDataChanged();
}

/** Sets one category's budget for a month that is already planned. */
export async function setBudget(
  db: Db,
  month: MonthKey,
  categoryId: string,
  amountCents: number,
): Promise<void> {
  const existing = await getMonth(db, month);
  if (!existing) throw new Error(`Plan ${month} before setting budgets`);
  await saveMonthPlan(db, {
    month,
    startingBalanceCents: existing.startingBalanceCents,
    budgets: [{ categoryId, amountCents }],
  });
}

/**
 * Everything the Month screen needs, ready for computeMonthSummary(): every active category,
 * plus archived ones that still have a budget or spending this month.
 * The database does the summing (SUM + GROUP BY); totals are never stored.
 */
export async function getMonthCategoryInputs(db: Db, month: MonthKey): Promise<CategoryInput[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    is_fixed: number;
    budget_cents: number | null;
    spent_cents: number | null;
  }>(
    `SELECT c.id, c.name, c.is_fixed,
            b.amount_cents AS budget_cents,
            s.spent_cents
     FROM categories c
     LEFT JOIN (
       SELECT b.category_id, b.amount_cents FROM category_budgets b
       JOIN months m ON m.id = b.month_id
       WHERE m.month_key = ? AND b.deleted_at IS NULL
     ) b ON b.category_id = c.id
     LEFT JOIN (
       SELECT category_id, SUM(amount_cents) AS spent_cents FROM expenses
       WHERE spent_on LIKE ? AND deleted_at IS NULL
       GROUP BY category_id
     ) s ON s.category_id = c.id
     WHERE c.deleted_at IS NULL
       AND (c.archived_at IS NULL OR b.amount_cents > 0 OR s.spent_cents > 0)
     ORDER BY c.sort_order, c.name`,
    [month, `${month}-%`],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isFixed: r.is_fixed === 1,
    budgetCents: r.budget_cents ?? 0,
    spentCents: r.spent_cents ?? 0,
  }));
}
