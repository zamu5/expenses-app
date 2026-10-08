import type { CategoryInput } from '@/domain/budget';
import type { MonthKey } from '@/domain/dates';
import { BUDGET_OWNER } from '@/domain/split';
import { newId, nowISO } from '@/lib/id';

import { notifyDataChanged } from '../events';
import type { Db, Month } from '../types';

interface MonthRow {
  id: string;
  month_key: string;
  starting_balance_cents: number;
  expected_income_cents: number;
}

export async function getMonth(db: Db, month: MonthKey): Promise<Month | null> {
  const row = await db.getFirstAsync<MonthRow>(
    `SELECT id, month_key, starting_balance_cents, expected_income_cents FROM months
     WHERE month_key = ? AND deleted_at IS NULL`,
    [month],
  );
  return row
    ? {
        id: row.id,
        monthKey: row.month_key,
        startingBalanceCents: row.starting_balance_cents,
        expectedIncomeCents: row.expected_income_cents,
      }
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
  /** What the month starts with. Left out, an existing month keeps what it had. */
  startingBalanceCents?: number;
  /** Income expected this month. Left out, an existing month keeps what it had. */
  expectedIncomeCents?: number;
  budgets: { categoryId: string; amountCents: number }[];
  /** Categories taken out of this month only. They stay available for other months. */
  removedCategoryIds?: string[];
}

/** Creates or updates a month and all its budgets in one transaction: all of it is saved, or none. */
export async function saveMonthPlan(db: Db, plan: MonthPlan): Promise<void> {
  const now = nowISO();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO months
         (id, month_key, starting_balance_cents, expected_income_cents, created_at, updated_at)
       VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 0), ?, ?)
       ON CONFLICT (month_key) DO UPDATE SET
         starting_balance_cents = COALESCE(?, starting_balance_cents),
         expected_income_cents = COALESCE(?, expected_income_cents),
         updated_at = excluded.updated_at`,
      [
        newId(),
        plan.month,
        plan.startingBalanceCents ?? null,
        plan.expectedIncomeCents ?? null,
        now,
        now,
        plan.startingBalanceCents ?? null,
        plan.expectedIncomeCents ?? null,
      ],
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

    // A soft-deleted budget row is what records "not in this month" (see listCategoriesForMonth).
    for (const categoryId of plan.removedCategoryIds ?? []) {
      await db.runAsync(
        `INSERT INTO category_budgets
           (id, month_id, category_id, amount_cents, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT (month_id, category_id) DO UPDATE SET
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`,
        [newId(), month.id, categoryId, now, now, now],
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
    budgets: [{ categoryId, amountCents }],
  });
}

/**
 * Everything the Month screen needs, ready for computeMonthSummary(): the categories in this
 * month's plan (see listCategoriesForMonth), plus any other category with spending this month,
 * so money is never hidden.
 * `spentCents` is the budget owner's share: shared expenses count half, and expenses only for the
 * other person count nothing; refunds for the category are taken off. The database does the summing (SUM + GROUP BY); totals are never stored.
 */
export async function getMonthCategoryInputs(db: Db, month: MonthKey): Promise<CategoryInput[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    is_fixed: number;
    budget_cents: number | null;
    any_cents: number | null;
    share_cents: number | null;
    refund_cents: number | null;
  }>(
    `SELECT c.id, c.name, c.is_fixed,
            CASE WHEN b.deleted_at IS NULL THEN b.amount_cents END AS budget_cents,
            s.any_cents, s.share_cents, r.refund_cents
     FROM categories c
     LEFT JOIN (
       SELECT b.category_id, b.amount_cents, b.deleted_at FROM category_budgets b
       JOIN months m ON m.id = b.month_id
       WHERE m.month_key = ?
     ) b ON b.category_id = c.id
     LEFT JOIN (
       SELECT category_id,
              SUM(amount_cents) AS any_cents,
              -- The same rule as ownerShareCents(), expense by expense. "/ 2" rounds down.
              SUM(CASE
                    WHEN for_whom = ? THEN amount_cents
                    WHEN for_whom <> 'shared' THEN 0
                    WHEN paid_by = ? THEN amount_cents - amount_cents / 2
                    ELSE amount_cents / 2
                  END) AS share_cents
       FROM expenses
       WHERE spent_on LIKE ? AND deleted_at IS NULL
       GROUP BY category_id
     ) s ON s.category_id = c.id
     LEFT JOIN (
       -- Refunds for this category in the month: the owner's part, as refundOwnerShareCents().
       SELECT category_id,
              SUM(CASE
                    WHEN for_whom = ? THEN amount_cents
                    WHEN for_whom = 'shared' THEN amount_cents - amount_cents / 2
                    ELSE 0
                  END) AS refund_cents
       FROM incomes
       WHERE received_on LIKE ? AND deleted_at IS NULL AND category_id IS NOT NULL
       GROUP BY category_id
     ) r ON r.category_id = c.id
     WHERE c.deleted_at IS NULL
       AND (s.any_cents > 0
         OR (b.category_id IS NOT NULL AND b.deleted_at IS NULL
             AND (c.archived_at IS NULL OR b.amount_cents > 0))
         OR (b.category_id IS NULL AND c.is_monthly = 1 AND c.archived_at IS NULL))
     ORDER BY c.sort_order, c.name`,
    [month, BUDGET_OWNER, BUDGET_OWNER, `${month}-%`, BUDGET_OWNER, `${month}-%`],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isFixed: r.is_fixed === 1,
    budgetCents: r.budget_cents ?? 0,
    // Refunds take away from what was spent. It can go below zero when more came back than
    // was spent this month; screens show that as zero spent.
    spentCents: (r.share_cents ?? 0) - (r.refund_cents ?? 0),
  }));
}
