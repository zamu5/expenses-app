/**
 * @jest-environment node
 */
import { computeMonthSummary } from '@/domain/budget';
import { balanceCents } from '@/domain/split';

import { subscribeToDataChanges } from '../events';
import { LATEST_SCHEMA_VERSION, migrate } from '../migrations';
import {
  createCategory,
  listCategories,
  listCategoriesForMonth,
  setCategoryArchived,
} from '../repositories/categories';
import { addExpense, deleteExpense, listExpenses, updateExpense } from '../repositories/expenses';
import {
  getBudgets,
  getMonth,
  getMonthCategoryInputs,
  getPreviousPlan,
  saveMonthPlan,
  setBudget,
} from '../repositories/months';
import {
  addSettlement,
  deleteSettlement,
  getSplitTotals,
  listSettlements,
} from '../repositories/settlements';
import type { Db } from '../types';
import { createTestDb } from './node-db';

jest.mock('@/lib/id', () => ({
  newId: () => crypto.randomUUID(),
  nowISO: () => new Date().toISOString(),
}));

let db: Db;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
});

const idOf = async (name: string) => (await listCategories(db)).find((c) => c.name === name)!.id;

describe('migrations', () => {
  it('creates the schema and the starter categories', async () => {
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);
    const names = (await listCategories(db)).map((c) => c.name);
    expect(names).toEqual(['Rent', 'Utilities', 'Groceries', 'Transport', 'Eating out', 'Fun']);
  });

  it('is safe to run again on every launch', async () => {
    await migrate(db);
    expect(await listCategories(db)).toHaveLength(6);
  });
});

describe('a month end to end', () => {
  it('reproduces the worked example from the plan', async () => {
    const [rent, groceries, transport, fun] = await Promise.all(
      ['Rent', 'Groceries', 'Transport', 'Fun'].map(idOf),
    );
    await saveMonthPlan(db, {
      month: '2026-10',
      startingBalanceCents: 300000,
      budgets: [
        { categoryId: rent, amountCents: 120000 },
        { categoryId: groceries, amountCents: 40000 },
        { categoryId: transport, amountCents: 15000 },
        { categoryId: fun, amountCents: 20000 },
      ],
    });
    await addExpense(db, { categoryId: rent, amountCents: 120000, spentOn: '2026-10-01' });
    await addExpense(db, { categoryId: groceries, amountCents: 7000, spentOn: '2026-10-02' });
    await addExpense(db, { categoryId: groceries, amountCents: 5000, spentOn: '2026-10-06' });
    await addExpense(db, { categoryId: transport, amountCents: 6000, spentOn: '2026-10-03' });
    await addExpense(db, { categoryId: fun, amountCents: 3000, spentOn: '2026-10-05' });
    // A September expense must not count toward October.
    await addExpense(db, { categoryId: fun, amountCents: 99900, spentOn: '2026-09-30' });

    const month = await getMonth(db, '2026-10');
    const summary = computeMonthSummary({
      startingBalanceCents: month!.startingBalanceCents,
      categories: await getMonthCategoryInputs(db, '2026-10'),
      daysInMonth: 31,
      daysElapsed: 7,
    });
    expect(summary.currentBalanceCents).toBe(159000);
    expect(summary.plannedEndCents).toBe(105000);
    expect(summary.projectedEndCents).toBe(87000);
    expect(summary.status).toBe('watch');
  });
});

describe('expenses', () => {
  it('lists a month newest first and hides deleted ones', async () => {
    const fun = await idOf('Fun');
    const a = await addExpense(db, { categoryId: fun, amountCents: 100, spentOn: '2026-10-01' });
    await addExpense(db, { categoryId: fun, amountCents: 200, spentOn: '2026-10-05', note: '  movie ' });
    expect((await listExpenses(db, '2026-10')).map((e) => e.amountCents)).toEqual([200, 100]);
    expect((await listExpenses(db, '2026-10'))[0].note).toBe('movie');

    await deleteExpense(db, a);
    expect(await listExpenses(db, '2026-10')).toHaveLength(1);
  });

  it('moves an expense between categories on edit', async () => {
    const [fun, groceries] = await Promise.all(['Fun', 'Groceries'].map(idOf));
    const id = await addExpense(db, { categoryId: fun, amountCents: 100, spentOn: '2026-10-01' });
    await updateExpense(db, id, { categoryId: groceries, amountCents: 150, spentOn: '2026-10-02' });
    expect(await listExpenses(db, '2026-10', fun)).toHaveLength(0);
    expect((await listExpenses(db, '2026-10', groceries))[0].amountCents).toBe(150);
  });

  it('refuses an expense pointing at a category that does not exist', async () => {
    await expect(
      addExpense(db, { categoryId: 'nope', amountCents: 100, spentOn: '2026-10-01' }),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('notifies listeners on every write', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToDataChanges(listener);
    await addExpense(db, { categoryId: await idOf('Fun'), amountCents: 1, spentOn: '2026-10-01' });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('month plans', () => {
  it('updates budgets in place instead of duplicating them', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', startingBalanceCents: 1000, budgets: [{ categoryId: fun, amountCents: 50 }] });
    await setBudget(db, '2026-10', fun, 75);
    expect(await getBudgets(db, '2026-10')).toEqual({ [fun]: 75 });
    expect((await getMonth(db, '2026-10'))?.startingBalanceCents).toBe(1000);
  });

  it('finds the previous plan to pre-fill a new month', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-08', startingBalanceCents: 1, budgets: [{ categoryId: fun, amountCents: 10 }] });
    await saveMonthPlan(db, { month: '2026-09', startingBalanceCents: 2, budgets: [{ categoryId: fun, amountCents: 20 }] });
    const previous = await getPreviousPlan(db, '2026-11');
    expect(previous?.month.monthKey).toBe('2026-09');
    expect(previous?.budgets[fun]).toBe(20);
  });

  it('keeps archived categories in months where they were used', async () => {
    const fun = await idOf('Fun');
    await addExpense(db, { categoryId: fun, amountCents: 500, spentOn: '2026-09-10' });
    await setCategoryArchived(db, fun, true);
    expect((await getMonthCategoryInputs(db, '2026-09')).some((c) => c.id === fun)).toBe(true);
    expect((await getMonthCategoryInputs(db, '2026-10')).some((c) => c.id === fun)).toBe(false);
  });

  it('adds new categories at the end', async () => {
    await createCategory(db, { name: ' Pets ', isFixed: false });
    const all = await listCategories(db);
    expect(all.at(-1)?.name).toBe('Pets');
  });
});

describe('categories that are not monthly', () => {
  const namesIn = async (month: string) => (await listCategoriesForMonth(db, month)).map((c) => c.name);
  const plan = (month: string, budgets: { categoryId: string; amountCents: number }[], removed: string[] = []) =>
    saveMonthPlan(db, { month, startingBalanceCents: 1000, budgets, removedCategoryIds: removed });

  it('are only in the months they were added to', async () => {
    const insurance = await createCategory(db, { name: 'Insurance', isFixed: true, isMonthly: false });
    expect(await namesIn('2026-10')).not.toContain('Insurance');

    await plan('2026-10', [{ categoryId: insurance, amountCents: 60000 }]);
    expect(await namesIn('2026-10')).toContain('Insurance');
    expect(await namesIn('2026-11')).not.toContain('Insurance');
    expect((await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === insurance)?.budgetCents).toBe(60000);
    expect((await getMonthCategoryInputs(db, '2026-11')).some((c) => c.id === insurance)).toBe(false);
  });

  it('a monthly category can be removed from one month and added back', async () => {
    const fun = await idOf('Fun');
    await plan('2026-10', [{ categoryId: fun, amountCents: 5000 }]);
    await plan('2026-10', [], [fun]);
    expect(await namesIn('2026-10')).not.toContain('Fun');
    expect(await namesIn('2026-11')).toContain('Fun');
    expect(await getBudgets(db, '2026-10')).toEqual({});
    expect((await getMonthCategoryInputs(db, '2026-10')).some((c) => c.id === fun)).toBe(false);

    await plan('2026-10', [{ categoryId: fun, amountCents: 7000 }]);
    expect(await namesIn('2026-10')).toContain('Fun');
    expect(await getBudgets(db, '2026-10')).toEqual({ [fun]: 7000 });
  });

  it('a removed category still shows when money was spent on it', async () => {
    const fun = await idOf('Fun');
    await plan('2026-10', [], [fun]);
    await addExpense(db, { categoryId: fun, amountCents: 900, spentOn: '2026-10-03' });
    const row = (await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === fun);
    expect(row).toMatchObject({ budgetCents: 0, spentCents: 900 });
  });
});

describe('who owes whom', () => {
  it('stores who paid and who it was for', async () => {
    const fun = await idOf('Fun');
    const id = await addExpense(db, { categoryId: fun, amountCents: 100, spentOn: '2026-10-01', paidBy: 'adriana', forWhom: 'sergio' });
    expect((await listExpenses(db, '2026-10'))[0]).toMatchObject({ paidBy: 'adriana', forWhom: 'sergio' });
    await updateExpense(db, id, { categoryId: fun, amountCents: 100, spentOn: '2026-10-01', paidBy: 'sergio', forWhom: 'shared' });
    expect((await listExpenses(db, '2026-10'))[0]).toMatchObject({ paidBy: 'sergio', forWhom: 'shared' });
  });

  it('adds up across months and returns to zero after settling', async () => {
    const fun = await idOf('Fun');
    const add = (amountCents: number, spentOn: string, paidBy: 'sergio' | 'adriana', forWhom: 'shared' | 'sergio' | 'adriana') =>
      addExpense(db, { categoryId: fun, amountCents, spentOn, paidBy, forWhom });
    await add(10000, '2026-09-10', 'sergio', 'shared'); // Adriana owes 5000
    await add(4000, '2026-10-02', 'adriana', 'shared'); // Sergio owes 2000
    await add(1500, '2026-10-03', 'sergio', 'adriana'); // Adriana owes 1500
    await add(9900, '2026-10-04', 'sergio', 'sergio'); // nobody owes anything
    const deleted = await add(7000, '2026-10-05', 'adriana', 'sergio');
    await deleteExpense(db, deleted);
    expect(balanceCents(await getSplitTotals(db))).toBe(4500);

    const wrong = await addSettlement(db, { fromPerson: 'adriana', amountCents: 1, settledOn: '2026-10-06' });
    await deleteSettlement(db, wrong);
    await addSettlement(db, { fromPerson: 'adriana', amountCents: 4500, settledOn: '2026-10-06' });
    expect(balanceCents(await getSplitTotals(db))).toBe(0);
    expect(await listSettlements(db)).toEqual([
      expect.objectContaining({ fromPerson: 'adriana', toPerson: 'sergio', amountCents: 4500 }),
    ]);
  });
});
