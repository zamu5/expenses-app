/**
 * @jest-environment node
 */
import { computeNetWorth } from '@/domain/accounts';
import { parseBackup } from '@/domain/backup';
import { computeMonthSummary } from '@/domain/budget';
import { balanceCents, expenseDebt, ownerShareCents } from '@/domain/split';

import { subscribeToDataChanges } from '../events';
import { LATEST_SCHEMA_VERSION, migrate } from '../migrations';
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listExchangeRates,
  payCard,
  setExchangeRate,
  updateAccount,
} from '../repositories/accounts';
import { exportBackup, getLastBackupAt, restoreBackup, setLastBackupAt } from '../repositories/backup';
import {
  createCategory,
  listCategories,
  listCategoriesForMonth,
  setCategoryArchived,
} from '../repositories/categories';
import {
  addExpense,
  deleteExpense,
  listDebtExpenses,
  listExpenses,
  saveExpenseWithPart,
  updateExpense,
} from '../repositories/expenses';
import { addIncome, deleteIncome, getIncomeTotal, listIncomes, updateIncome } from '../repositories/incomes';
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
import { DEFAULT_PEOPLE_NAMES, getPeopleNames, setPeopleNames } from '../repositories/settings';
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
    await addExpense(db, { categoryId: rent, amountCents: 120000, spentOn: '2026-10-01', forWhom: 'sergio' });
    await addExpense(db, { categoryId: groceries, amountCents: 7000, spentOn: '2026-10-02', forWhom: 'sergio' });
    await addExpense(db, { categoryId: groceries, amountCents: 5000, spentOn: '2026-10-06', forWhom: 'sergio' });
    await addExpense(db, { categoryId: transport, amountCents: 6000, spentOn: '2026-10-03', forWhom: 'sergio' });
    await addExpense(db, { categoryId: fun, amountCents: 3000, spentOn: '2026-10-05', forWhom: 'sergio' });
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
    expect(summary.status).toBe('onTrack');
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
    await addExpense(db, { categoryId: fun, amountCents: 900, spentOn: '2026-10-03', forWhom: 'sergio' });
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

describe('income', () => {
  it('is totalled per month and ignores deleted rows', async () => {
    const salary = await addIncome(db, { amountCents: 250000, receivedOn: '2026-10-15', note: ' Salary ' });
    await addIncome(db, { amountCents: 5000, receivedOn: '2026-10-20' });
    await addIncome(db, { amountCents: 99900, receivedOn: '2026-11-01' });
    expect(await getIncomeTotal(db, '2026-10')).toBe(255000);
    expect((await listIncomes(db, '2026-10')).map((i) => i.note)).toEqual([null, 'Salary']);

    await updateIncome(db, salary, { amountCents: 260000, receivedOn: '2026-10-15' });
    expect(await getIncomeTotal(db, '2026-10')).toBe(265000);
    await deleteIncome(db, salary);
    expect(await getIncomeTotal(db, '2026-10')).toBe(5000);
    expect(await getIncomeTotal(db, '2026-12')).toBe(0);
  });

  it('refuses an income of zero', async () => {
    await expect(addIncome(db, { amountCents: 0, receivedOn: '2026-10-15' })).rejects.toThrow(/CHECK/);
  });
});

describe('accounts', () => {
  const account = (name: string, currency: string, balanceCents: number, extra = {}) =>
    createAccount(db, { name, kind: 'account', currency, balanceCents, balanceUpdatedOn: '2026-10-07', ...extra });

  it('starts with none, and lists accounts before planned expenses', async () => {
    expect(await listAccounts(db)).toEqual([]);
    await createAccount(db, { name: 'Trip', kind: 'planned', currency: 'CAD', balanceCents: 300000, balanceUpdatedOn: '2026-10-07' });
    await account(' Savings ', 'CAD', 1000000);
    expect((await listAccounts(db)).map((a) => [a.name, a.kind])).toEqual([
      ['Savings', 'account'],
      ['Trip', 'planned'],
    ]);
  });

  it('no longer has a budget account: an upgrade clears the old mark', async () => {
    // A database as it was at version 5, with an account marked the old way.
    db = createTestDb();
    await migrate(db, 5);
    await db.runAsync(
      `INSERT INTO accounts (id, name, kind, currency, balance_cents, is_budget_account, balance_updated_on, created_at, updated_at)
       VALUES ('a1', 'Chequing', 'account', 'CAD', 214498, 1, '2026-10-01', 'x', 'x')`,
      [],
    );

    await migrate(db);
    const row = await db.getFirstAsync<{ is_budget_account: number }>(
      "SELECT is_budget_account FROM accounts WHERE id = 'a1'",
      [],
    );
    expect(row?.is_budget_account).toBe(0);
    // The balance is whatever was typed; nothing is worked out for it.
    expect((await listAccounts(db))[0]).toMatchObject({ name: 'Chequing', balanceCents: 214498 });
  });

  it('feeds the net worth math, with a typed exchange rate', async () => {
    await account('Investments', 'CAD', 1000000);
    const pesos = await account('Pesos', 'COP', 295000000);
    await account('More pesos', 'COP', 295000000);
    await createAccount(db, { name: 'Trip', kind: 'planned', currency: 'CAD', balanceCents: 300000, balanceUpdatedOn: '2026-10-07' });

    const rates = async () => Object.fromEntries((await listExchangeRates(db)).map((r) => [r.currency, r.unitsPerHome]));
    expect(computeNetWorth(await listAccounts(db), await rates(), 'CAD').missingRates).toEqual(['COP']);

    await setExchangeRate(db, { currency: 'COP', unitsPerHome: 3000, setOn: '2026-10-01' });
    await setExchangeRate(db, { currency: 'COP', unitsPerHome: 2950, setOn: '2026-10-07' });
    expect(await listExchangeRates(db)).toEqual([{ currency: 'COP', unitsPerHome: 2950, setOn: '2026-10-07' }]);
    // 10,000 + 2,000 (5,900,000 COP) - 3,000 planned
    expect(computeNetWorth(await listAccounts(db), await rates(), 'CAD').totalHomeCents).toBe(900000);

    await deleteAccount(db, pesos);
    expect(computeNetWorth(await listAccounts(db), await rates(), 'CAD').totalHomeCents).toBe(800000);
  });
});

describe('backup and restore', () => {
  async function fill() {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', startingBalanceCents: 300000, budgets: [{ categoryId: fun, amountCents: 20000 }] });
    await addExpense(db, { categoryId: fun, amountCents: 3000, spentOn: '2026-10-05', paidBy: 'adriana', forWhom: 'shared', note: 'Movie' });
    const gone = await addExpense(db, { categoryId: fun, amountCents: 100, spentOn: '2026-10-06' });
    await deleteExpense(db, gone);
    await addIncome(db, { amountCents: 250000, receivedOn: '2026-10-15', note: 'Salary' });
    await addSettlement(db, { fromPerson: 'sergio', amountCents: 1500, settledOn: '2026-10-07' });
    await createAccount(db, { name: 'Pesos', kind: 'account', currency: 'COP', balanceCents: 295000000, balanceUpdatedOn: '2026-10-07' });
    await setExchangeRate(db, { currency: 'COP', unitsPerHome: 2950, setOn: '2026-10-07' });
  }
  const viaFile = async () => {
    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.backup;
  };

  it('round trips: export, wipe, restore gives identical data', async () => {
    await fill();
    const backup = await viaFile();
    expect(backup.schemaVersion).toBe(LATEST_SCHEMA_VERSION);

    // A brand new database, as on a new phone, with different starter category ids.
    db = createTestDb();
    await migrate(db);
    await addExpense(db, { categoryId: await idOf('Rent'), amountCents: 999, spentOn: '2026-10-01' });

    await restoreBackup(db, backup);
    expect((await exportBackup(db)).tables).toEqual(backup.tables);
    expect((await listExpenses(db, '2026-10')).map((e) => [e.amountCents, e.note, e.paidBy])).toEqual([[3000, 'Movie', 'adriana']]);
    expect(await getIncomeTotal(db, '2026-10')).toBe(250000);
    expect((await listAccounts(db)).map((a) => a.name)).toEqual(['Pesos']);
  });

  it('changes nothing when a row cannot be restored', async () => {
    await fill();
    const before = (await exportBackup(db)).tables;
    const bad = await viaFile();
    bad.tables.expenses = [{ ...bad.tables.expenses[0], category_id: 'no-such-category' }];

    await expect(restoreBackup(db, bad)).rejects.toThrow(/FOREIGN KEY/);
    expect((await exportBackup(db)).tables).toEqual(before);
  });

  it('restores a backup from an older version, filling new columns with defaults', async () => {
    await fill();
    const old = await viaFile();
    old.schemaVersion = 1;
    old.tables.expenses = old.tables.expenses.map(({ paid_by, for_whom, ...rest }) => rest);
    old.tables.categories = old.tables.categories.map(({ is_monthly, ...rest }) => ({ ...rest, column_from_the_past: 1 }));

    await restoreBackup(db, old);
    expect((await listExpenses(db, '2026-10'))[0]).toMatchObject({ paidBy: 'sergio', forWhom: 'shared' });
    expect((await listCategories(db)).every((c) => c.isMonthly)).toBe(true);
  });

  it('remembers when the last backup was made, outside the backup itself', async () => {
    expect(await getLastBackupAt(db)).toBeNull();
    await setLastBackupAt(db, '2026-10-07T12:00:00.000Z');
    await setLastBackupAt(db, '2026-10-08T09:00:00.000Z');
    expect(await getLastBackupAt(db)).toBe('2026-10-08T09:00:00.000Z');
    await restoreBackup(db, await viaFile());
    expect(await getLastBackupAt(db)).toBe('2026-10-08T09:00:00.000Z');
  });
});

describe('the budget counts only your share', () => {
  it('halves shared expenses and skips what was only for the other person', async () => {
    const [fun, transport] = await Promise.all(['Fun', 'Transport'].map(idOf));
    await saveMonthPlan(db, { month: '2026-10', startingBalanceCents: 300000, budgets: [
      { categoryId: transport, amountCents: 10000 },
      { categoryId: fun, amountCents: 20000 },
    ] });
    // Gas, shared, paid by Sergio: 41.67 counts, 58.33 is left.
    await addExpense(db, { categoryId: transport, amountCents: 8334, spentOn: '2026-10-02', paidBy: 'sergio', forWhom: 'shared' });
    await addExpense(db, { categoryId: fun, amountCents: 3000, spentOn: '2026-10-03', paidBy: 'adriana', forWhom: 'shared' });
    await addExpense(db, { categoryId: fun, amountCents: 2000, spentOn: '2026-10-04', paidBy: 'sergio', forWhom: 'sergio' });
    await addExpense(db, { categoryId: fun, amountCents: 7000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'adriana' });

    const byId = Object.fromEntries((await getMonthCategoryInputs(db, '2026-10')).map((c) => [c.id, c]));
    expect(byId[transport].spentCents).toBe(4167);
    expect(byId[transport].budgetCents - byId[transport].spentCents).toBe(5833);
    expect(byId[fun].spentCents).toBe(3500);
  });

  it('still lists a category whose only spending was for the other person', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', startingBalanceCents: 1000, budgets: [], removedCategoryIds: [fun] });
    await addExpense(db, { categoryId: fun, amountCents: 7000, spentOn: '2026-10-05', forWhom: 'adriana' });
    expect((await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === fun)).toMatchObject({ spentCents: 0 });
  });
});

describe('what a month starts with', () => {
  it('is saved with the plan and kept when only budgets change', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', startingBalanceCents: 1219715, budgets: [{ categoryId: fun, amountCents: 100 }] });
    expect((await getMonth(db, '2026-10'))?.startingBalanceCents).toBe(1219715);

    // Saving without it (a budget change, or the plan of a later month) leaves it alone.
    await setBudget(db, '2026-10', fun, 200);
    await saveMonthPlan(db, { month: '2026-10', budgets: [] });
    expect((await getMonth(db, '2026-10'))?.startingBalanceCents).toBe(1219715);

    await saveMonthPlan(db, { month: '2026-10', startingBalanceCents: 1300000, budgets: [] });
    expect((await getMonth(db, '2026-10'))?.startingBalanceCents).toBe(1300000);
  });

  it('is zero for a month saved without one', async () => {
    await saveMonthPlan(db, { month: '2026-10', budgets: [] });
    expect((await getMonth(db, '2026-10'))?.startingBalanceCents).toBe(0);
  });
});

describe('the detail behind what is owed', () => {
  it('lists only expenses that create a debt, from every month, with the category name', async () => {
    const [fun, transport] = await Promise.all(['Fun', 'Transport'].map(idOf));
    await addExpense(db, { categoryId: transport, amountCents: 8334, spentOn: '2026-09-28', paidBy: 'sergio', forWhom: 'shared' });
    await addExpense(db, { categoryId: fun, amountCents: 3000, spentOn: '2026-10-03', paidBy: 'adriana', forWhom: 'shared', note: 'Movie' });
    await addExpense(db, { categoryId: fun, amountCents: 2500, spentOn: '2026-10-04', paidBy: 'sergio', forWhom: 'adriana' });
    await addExpense(db, { categoryId: fun, amountCents: 999, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'sergio' });
    await deleteExpense(db, await addExpense(db, { categoryId: fun, amountCents: 5000, spentOn: '2026-10-06', paidBy: 'adriana', forWhom: 'sergio' }));

    const items = (await listDebtExpenses(db)).map((e) => ({ label: e.note ?? e.categoryName, ...expenseDebt(e)! }));
    expect(items).toEqual([
      { label: 'Fun', debtor: 'adriana', cents: 2500 },
      { label: 'Movie', debtor: 'sergio', cents: 1500 },
      { label: 'Transport', debtor: 'adriana', cents: 4167 },
    ]);
    // The items add up to the balance: 2,500 + 4,167 - 1,500.
    expect(balanceCents(await getSplitTotals(db))).toBe(5167);
  });
});

describe('every split number reconciles to the cent', () => {
  it('headline = sum of the lines - payments, and the budget share matches, with odd amounts', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', budgets: [{ categoryId: fun, amountCents: 100000 }] });
    const add = (amountCents: number, paidBy: 'sergio' | 'adriana', forWhom: 'shared' | 'sergio' | 'adriana') =>
      addExpense(db, { categoryId: fun, amountCents, spentOn: '2026-10-05', paidBy, forWhom });
    // Odd amounts on purpose: rounding each half on its own must not drift from the total.
    await add(8335, 'sergio', 'shared');
    await add(1001, 'sergio', 'shared');
    await add(333, 'sergio', 'shared');
    await add(4999, 'adriana', 'shared');
    await add(777, 'adriana', 'shared');
    await add(2501, 'sergio', 'adriana');
    await add(1203, 'adriana', 'sergio');
    await add(999, 'sergio', 'sergio');
    await addSettlement(db, { fromPerson: 'adriana', amountCents: 1000, settledOn: '2026-10-06' });
    await addSettlement(db, { fromPerson: 'sergio', amountCents: 250, settledOn: '2026-10-07' });

    const lines = (await listDebtExpenses(db)).map((e) => expenseDebt(e)!);
    const owedBy = (debtor: string) => lines.filter((l) => l.debtor === debtor).reduce((sum, l) => sum + l.cents, 0);
    const headline = balanceCents(await getSplitTotals(db));
    // Adriana's lines - Sergio's lines - what she paid back + what he paid her.
    expect(headline).toBe(owedBy('adriana') - owedBy('sergio') - 1000 + 250);

    const everything = await listExpenses(db, '2026-10');
    const spent = (await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === fun)!.spentCents;
    expect(spent).toBe(everything.reduce((sum, e) => sum + ownerShareCents(e), 0));
  });
});

describe('expected income in the plan', () => {
  it('is saved with the plan, kept when only a budget changes, and offered to the next month', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', expectedIncomeCents: 250000, budgets: [{ categoryId: fun, amountCents: 100 }] });
    expect((await getMonth(db, '2026-10'))?.expectedIncomeCents).toBe(250000);

    await setBudget(db, '2026-10', fun, 200);
    expect((await getMonth(db, '2026-10'))?.expectedIncomeCents).toBe(250000);

    await saveMonthPlan(db, { month: '2026-10', expectedIncomeCents: 0, budgets: [] });
    expect((await getMonth(db, '2026-10'))?.expectedIncomeCents).toBe(0);

    await saveMonthPlan(db, { month: '2026-10', expectedIncomeCents: 260000, budgets: [] });
    expect((await getPreviousPlan(db, '2026-11'))?.month.expectedIncomeCents).toBe(260000);
  });

  it('is zero for a month planned without it', async () => {
    await saveMonthPlan(db, { month: '2026-10', budgets: [] });
    expect((await getMonth(db, '2026-10'))?.expectedIncomeCents).toBe(0);
  });
});

describe('one purchase in two categories', () => {
  it('saves it as two expenses that share the date, note, payer and "for"', async () => {
    const [groceries, fun] = await Promise.all(['Groceries', 'Fun'].map(idOf));
    await saveExpenseWithPart(
      db,
      null,
      { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', note: 'Costco', paidBy: 'adriana', forWhom: 'shared' },
      { categoryId: fun, amountCents: 5000 },
    );
    const saved = (await listExpenses(db, '2026-10')).map((e) => [e.categoryId, e.amountCents, e.note, e.paidBy, e.forWhom, e.spentOn]);
    expect(saved).toHaveLength(2);
    expect(saved).toContainEqual([groceries, 15000, 'Costco', 'adriana', 'shared', '2026-10-05']);
    expect(saved).toContainEqual([fun, 5000, 'Costco', 'adriana', 'shared', '2026-10-05']);
    // Nothing is lost or invented: what is owed is still half of the 200.00.
    expect(balanceCents(await getSplitTotals(db))).toBe(-10000);
  });

  it('can split an expense that already exists', async () => {
    const [groceries, fun] = await Promise.all(['Groceries', 'Fun'].map(idOf));
    const id = await addExpense(db, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', note: 'Costco' });
    await saveExpenseWithPart(db, id, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', note: 'Costco' }, { categoryId: fun, amountCents: 5000 });
    expect((await listExpenses(db, '2026-10', groceries)).map((e) => [e.id, e.amountCents])).toEqual([[id, 15000]]);
    expect((await listExpenses(db, '2026-10', fun)).map((e) => e.amountCents)).toEqual([5000]);
  });

  it('saves neither half when the other category does not exist', async () => {
    const groceries = await idOf('Groceries');
    await expect(
      saveExpenseWithPart(db, null, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05' }, { categoryId: 'nope', amountCents: 5000 }),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(await listExpenses(db, '2026-10')).toEqual([]);
  });
});

describe('the part of a split can be for someone else', () => {
  it('shared groceries with clothes only for Adriana', async () => {
    const [groceries, fun] = await Promise.all(['Groceries', 'Fun'].map(idOf));
    await saveMonthPlan(db, { month: '2026-10', budgets: [
      { categoryId: groceries, amountCents: 40000 },
      { categoryId: fun, amountCents: 10000 },
    ] });
    await saveExpenseWithPart(
      db,
      null,
      { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', note: 'Costco', paidBy: 'sergio', forWhom: 'shared' },
      { categoryId: fun, amountCents: 5000, forWhom: 'adriana' },
    );
    expect((await listExpenses(db, '2026-10', groceries))[0]).toMatchObject({ amountCents: 15000, forWhom: 'shared' });
    expect((await listExpenses(db, '2026-10', fun))[0]).toMatchObject({ amountCents: 5000, forWhom: 'adriana', paidBy: 'sergio' });
    // Adriana owes half of the 150.00 groceries and all of her 50.00.
    expect(balanceCents(await getSplitTotals(db))).toBe(12500);
    // The budgets count Sergio's share only: 75.00 of groceries, nothing of her clothes.
    const spent = Object.fromEntries((await getMonthCategoryInputs(db, '2026-10')).map((c) => [c.id, c.spentCents]));
    expect(spent[groceries]).toBe(7500);
    expect(spent[fun]).toBe(0);
  });
});

describe('refunds', () => {
  const setup = async () => {
    const groceries = await idOf('Groceries');
    await saveMonthPlan(db, { month: '2026-10', budgets: [{ categoryId: groceries, amountCents: 40000 }] });
    return groceries;
  };
  const spentIn = async (categoryId: string) =>
    (await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === categoryId)!.spentCents;

  it('a shared refund on a shared expense gives half back to each', async () => {
    const groceries = await setup();
    await addExpense(db, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'shared' });
    expect(await spentIn(groceries)).toBe(10000);
    expect(balanceCents(await getSplitTotals(db))).toBe(10000);

    await addIncome(db, { amountCents: 10000, receivedOn: '2026-10-09', categoryId: groceries, forWhom: 'shared' });
    expect(await spentIn(groceries)).toBe(5000);
    expect(balanceCents(await getSplitTotals(db))).toBe(5000);
  });

  it('a refund only for you lowers your spending in full and leaves the balance alone', async () => {
    const groceries = await setup();
    await addExpense(db, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', forWhom: 'sergio' });
    await addIncome(db, { amountCents: 4000, receivedOn: '2026-10-09', categoryId: groceries });
    expect(await spentIn(groceries)).toBe(16000);
    expect(balanceCents(await getSplitTotals(db))).toBe(0);
  });

  it('a refund only for Adriana changes only what is owed', async () => {
    const groceries = await setup();
    await addExpense(db, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'adriana' });
    await addIncome(db, { amountCents: 20000, receivedOn: '2026-10-09', categoryId: groceries, forWhom: 'adriana' });
    expect(await spentIn(groceries)).toBe(0);
    expect(balanceCents(await getSplitTotals(db))).toBe(0);
  });

  it('is not counted as income, and belongs to the month it was received in', async () => {
    const groceries = await setup();
    await addIncome(db, { amountCents: 250000, receivedOn: '2026-10-15', note: 'Salary' });
    await addIncome(db, { amountCents: 4000, receivedOn: '2026-10-09', categoryId: groceries });
    await addIncome(db, { amountCents: 9900, receivedOn: '2026-11-02', categoryId: groceries });
    expect(await getIncomeTotal(db, '2026-10')).toBe(250000);
    expect((await listIncomes(db, '2026-10', groceries)).map((i) => i.amountCents)).toEqual([4000]);
    expect(await spentIn(groceries)).toBe(-4000);
  });

  it('a deleted refund no longer counts', async () => {
    const groceries = await setup();
    await addExpense(db, { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', forWhom: 'sergio' });
    const refund = await addIncome(db, { amountCents: 4000, receivedOn: '2026-10-09', categoryId: groceries, forWhom: 'shared' });
    await deleteIncome(db, refund);
    expect(await spentIn(groceries)).toBe(20000);
    expect(balanceCents(await getSplitTotals(db))).toBe(0);
  });
});

describe('income goes into an account', () => {
  const account = (name: string, balanceCents: number, extra = {}) =>
    createAccount(db, { name, kind: 'account', currency: 'CAD', balanceCents, balanceUpdatedOn: '2026-10-01', ...extra });
  const balanceOf = async (id: string) => (await listAccounts(db)).find((a) => a.id === id)!.balanceCents;

  it('adds the amount to the account, and follows edits and deletes', async () => {
    const main = await account('Main', 100000);
    const other = await account('Other', 5000);

    const id = await addIncome(db, { amountCents: 250000, receivedOn: '2026-10-15', accountId: main });
    expect(await balanceOf(main)).toBe(350000);

    await updateIncome(db, id, { amountCents: 260000, receivedOn: '2026-10-15', accountId: main });
    expect(await balanceOf(main)).toBe(360000);

    // Moved to another account: out of one, into the other.
    await updateIncome(db, id, { amountCents: 260000, receivedOn: '2026-10-15', accountId: other });
    expect(await balanceOf(main)).toBe(100000);
    expect(await balanceOf(other)).toBe(265000);

    await deleteIncome(db, id);
    expect(await balanceOf(other)).toBe(5000);
  });

  it('changes no balance when no account is picked', async () => {
    const main = await account('Main', 100000);
    const id = await addIncome(db, { amountCents: 250000, receivedOn: '2026-10-15' });
    expect(await balanceOf(main)).toBe(100000);
    await deleteIncome(db, id);
    expect(await balanceOf(main)).toBe(100000);
  });

  it('keeps a single default account for income', async () => {
    const first = await account('First', 0, { isIncomeDefault: true });
    const second = await account('Second', 0, { isIncomeDefault: true });
    expect((await listAccounts(db)).filter((a) => a.isIncomeDefault).map((a) => a.id)).toEqual([second]);

    await updateAccount(db, first, { name: 'First', kind: 'account', currency: 'CAD', balanceCents: 0, isIncomeDefault: true, balanceUpdatedOn: '2026-10-02' });
    expect((await listAccounts(db)).filter((a) => a.isIncomeDefault).map((a) => a.id)).toEqual([first]);
  });

  it('survives a backup and restore, links included', async () => {
    const groceries = await idOf('Groceries');
    const main = await account('Main', 100000, { isIncomeDefault: true });
    await addIncome(db, { amountCents: 4000, receivedOn: '2026-10-09', accountId: main, categoryId: groceries, forWhom: 'shared' });

    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);
    db = createTestDb();
    await migrate(db);
    await restoreBackup(db, parsed.backup);

    expect((await listIncomes(db, '2026-10'))[0]).toMatchObject({ accountId: main, categoryId: groceries, forWhom: 'shared' });
    expect((await listAccounts(db))[0]).toMatchObject({ balanceCents: 104000, isIncomeDefault: true });
  });
});

describe('credit cards and what an expense was paid with', () => {
  const bank = (name: string, balanceCents: number) =>
    createAccount(db, { name, kind: 'account', currency: 'CAD', balanceCents, balanceUpdatedOn: '2026-10-01' });
  const card = (name: string, owedCents: number, linkedAccountId: string, extra = {}) =>
    createAccount(db, { name, kind: 'account', currency: 'CAD', balanceCents: -owedCents, linkedAccountId, balanceUpdatedOn: '2026-10-01', ...extra });
  const balances = async () => Object.fromEntries((await listAccounts(db)).map((a) => [a.name, a.balanceCents]));
  const total = async () => computeNetWorth(await listAccounts(db), {}, 'CAD').totalHomeCents;

  it('a card expense grows the debt by the full amount, and follows edits and deletes', async () => {
    const fun = await idOf('Fun');
    const chequing = await bank('Chequing', 200000);
    const visa = await card('Visa', 30000, chequing);
    expect(await total()).toBe(170000);

    // Shared, but the card is charged all of it; the other half is in what Adriana owes.
    const id = await addExpense(db, { categoryId: fun, amountCents: 8334, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'shared', paymentAccountId: visa });
    expect(await balances()).toEqual({ Chequing: 200000, Visa: -38334 });

    await updateExpense(db, id, { categoryId: fun, amountCents: 10000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'shared', paymentAccountId: visa });
    expect((await balances()).Visa).toBe(-40000);

    // Paid from the bank account instead: the card gets it back, the account pays.
    await updateExpense(db, id, { categoryId: fun, amountCents: 10000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'shared', paymentAccountId: chequing });
    expect(await balances()).toEqual({ Chequing: 190000, Visa: -30000 });

    await deleteExpense(db, id);
    expect(await balances()).toEqual({ Chequing: 200000, Visa: -30000 });
  });

  it('an expense the other person paid, or one that is not tracked, moves nothing', async () => {
    const fun = await idOf('Fun');
    const chequing = await bank('Chequing', 200000);
    await card('Visa', 0, chequing);
    await addExpense(db, { categoryId: fun, amountCents: 5000, spentOn: '2026-10-05', paidBy: 'adriana', forWhom: 'shared' });
    await addExpense(db, { categoryId: fun, amountCents: 5000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'sergio' });
    expect(await balances()).toEqual({ Chequing: 200000, Visa: 0 });
  });

  it('both parts of a split are charged to the same card', async () => {
    const [groceries, fun] = await Promise.all(['Groceries', 'Fun'].map(idOf));
    const chequing = await bank('Chequing', 200000);
    const visa = await card('Visa', 0, chequing);
    await saveExpenseWithPart(
      db,
      null,
      { categoryId: groceries, amountCents: 20000, spentOn: '2026-10-05', paymentAccountId: visa },
      { categoryId: fun, amountCents: 5000 },
    );
    expect((await balances()).Visa).toBe(-20000);
    expect((await listExpenses(db, '2026-10')).every((e) => e.paymentAccountId === visa)).toBe(true);
  });

  it('paying the card moves money from its account and leaves the total alone', async () => {
    const chequing = await bank('Chequing', 200000);
    const visa = await card('Visa', 30000, chequing);
    const before = await total();
    await payCard(db, visa, 25000);
    expect(await balances()).toEqual({ Chequing: 175000, Visa: -5000 });
    expect(await total()).toBe(before);
    await expect(payCard(db, chequing, 100)).rejects.toThrow(/not a credit card/);
  });

  it('the first card takes the expenses logged before it, without changing its balance', async () => {
    const fun = await idOf('Fun');
    const mine = await addExpense(db, { categoryId: fun, amountCents: 5000, spentOn: '2026-10-02', paidBy: 'sergio' });
    const hers = await addExpense(db, { categoryId: fun, amountCents: 7000, spentOn: '2026-10-03', paidBy: 'adriana' });
    const chequing = await bank('Chequing', 200000);
    const visa = await card('Visa', 30000, chequing);

    const byId = Object.fromEntries((await listExpenses(db, '2026-10')).map((e) => [e.id, e.paymentAccountId]));
    expect(byId[mine]).toBe(visa);
    expect(byId[hers]).toBeNull();
    expect((await balances()).Visa).toBe(-30000);

    // A second card does not take anything over.
    const later = await addExpense(db, { categoryId: fun, amountCents: 100, spentOn: '2026-10-04', paidBy: 'sergio' });
    await card('Second', 0, chequing);
    expect((await listExpenses(db, '2026-10')).find((e) => e.id === later)?.paymentAccountId).toBeNull();
  });

  it('keeps one default payment method, and a card is never the default for income', async () => {
    const chequing = await bank('Chequing', 0);
    const visa = await card('Visa', 0, chequing, { isPaymentDefault: true, isIncomeDefault: true });
    await card('Other', 0, chequing, { isPaymentDefault: true });
    const all = await listAccounts(db);
    expect(all.filter((a) => a.isPaymentDefault).map((a) => a.name)).toEqual(['Other']);
    expect(all.find((a) => a.id === visa)?.isIncomeDefault).toBe(false);
  });

  it('survives a backup and restore, whatever order the card and its account come in', async () => {
    const fun = await idOf('Fun');
    const chequing = await bank('Chequing', 200000);
    const visa = await card('Visa', 30000, chequing, { isPaymentDefault: true });
    await addExpense(db, { categoryId: fun, amountCents: 5000, spentOn: '2026-10-05', paymentAccountId: visa });

    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);
    // Put the card before the account it points at.
    parsed.backup.tables.accounts.reverse();
    db = createTestDb();
    await migrate(db);
    await restoreBackup(db, parsed.backup);

    expect(await balances()).toEqual({ Chequing: 200000, Visa: -35000 });
    expect((await listAccounts(db)).find((a) => a.name === 'Visa')).toMatchObject({ linkedAccountId: chequing, isPaymentDefault: true });
    expect((await listExpenses(db, '2026-10'))[0].paymentAccountId).toBe(visa);
  });
});

describe('bank and investment accounts', () => {
  const make = (name: string, extra = {}) =>
    createAccount(db, { name, kind: 'account', currency: 'CAD', balanceCents: 100, balanceUpdatedOn: '2026-10-01', ...extra });
  const named = async (name: string) => (await listAccounts(db)).find((a) => a.name === name)!;

  it('is a bank account unless said otherwise, and can be changed', async () => {
    const id = await make('Savings');
    expect((await named('Savings')).accountType).toBe('bank');
    await updateAccount(db, id, { name: 'Savings', kind: 'account', accountType: 'investment', currency: 'CAD', balanceCents: 100, balanceUpdatedOn: '2026-10-01' });
    expect((await named('Savings')).accountType).toBe('investment');
  });

  it('an investment account cannot be a credit card or the default payment method', async () => {
    const bank = await make('Chequing');
    await make('Broker', { accountType: 'investment', linkedAccountId: bank, isPaymentDefault: true, isIncomeDefault: true });
    expect(await named('Broker')).toMatchObject({
      accountType: 'investment',
      linkedAccountId: null,
      isPaymentDefault: false,
      // Income can still be paid into it.
      isIncomeDefault: true,
    });
  });

  it('accounts from before the upgrade become bank accounts', async () => {
    db = createTestDb();
    await migrate(db, 9);
    await db.runAsync(
      `INSERT INTO accounts (id, name, kind, currency, balance_cents, balance_updated_on, created_at, updated_at)
       VALUES ('a1', 'Old', 'account', 'CAD', 5, '2026-10-01', 'x', 'x')`,
      [],
    );
    await migrate(db);
    expect((await named('Old')).accountType).toBe('bank');
  });
});

describe('the two names are a setting', () => {
  it('start neutral on a new database and can be changed', async () => {
    expect(await getPeopleNames(db)).toEqual(DEFAULT_PEOPLE_NAMES);
    await setPeopleNames(db, { sergio: ' Ana ', adriana: 'Luis' });
    expect(await getPeopleNames(db)).toEqual({ sergio: 'Ana', adriana: 'Luis' });
    // An empty name goes back to the neutral one.
    await setPeopleNames(db, { sergio: '', adriana: 'Luis' });
    expect(await getPeopleNames(db)).toEqual({ sergio: DEFAULT_PEOPLE_NAMES.sergio, adriana: 'Luis' });
  });

  it('a database that already had data keeps the names it was shown with', async () => {
    db = createTestDb();
    await migrate(db, 10);
    const fun = (await db.getFirstAsync<{ id: string }>("SELECT id FROM categories WHERE name = 'Fun'", []))!.id;
    await db.runAsync(
      `INSERT INTO expenses (id, category_id, amount_cents, spent_on, created_at, updated_at)
       VALUES ('e1', ?, 100, '2026-10-01', 'x', 'x')`,
      [fun],
    );
    await migrate(db);
    expect(await getPeopleNames(db)).toEqual({ sergio: 'Sergio', adriana: 'Adriana' });
  });

  it('an upgrade of an empty database stays neutral', async () => {
    db = createTestDb();
    await migrate(db, 10);
    await migrate(db);
    expect(await getPeopleNames(db)).toEqual(DEFAULT_PEOPLE_NAMES);
  });

  it('travel with a backup, and an old backup leaves the names alone', async () => {
    await setPeopleNames(db, { sergio: 'Ana', adriana: 'Luis' });
    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.backup.people).toEqual({ sergio: 'Ana', adriana: 'Luis' });

    db = createTestDb();
    await migrate(db);
    await restoreBackup(db, parsed.backup);
    expect(await getPeopleNames(db)).toEqual({ sergio: 'Ana', adriana: 'Luis' });

    // A backup made before names were a setting has no names in it.
    delete parsed.backup.people;
    await setPeopleNames(db, { sergio: 'Kept', adriana: 'Also kept' });
    await restoreBackup(db, parsed.backup);
    expect(await getPeopleNames(db)).toEqual({ sergio: 'Kept', adriana: 'Also kept' });
  });
});

describe('a split chosen on each shared expense', () => {
  const spentIn = async (categoryId: string) =>
    (await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === categoryId)!.spentCents;
  const shared = (categoryId: string, amountCents: number, paidBy: 'sergio' | 'adriana', ownerSharePct?: number) =>
    addExpense(db, { categoryId, amountCents, spentOn: '2026-10-05', paidBy, forWhom: 'shared', ownerSharePct });

  it('is half and half unless the expense says otherwise', async () => {
    const fun = await idOf('Fun');
    await shared(fun, 10000, 'sergio');
    expect((await listExpenses(db, '2026-10'))[0].ownerSharePct).toBe(50);
    expect(balanceCents(await getSplitTotals(db))).toBe(5000);
  });

  it('60/40 each way, odd cents included', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', budgets: [{ categoryId: fun, amountCents: 100000 }] });

    await shared(fun, 1001, 'sergio', 60);
    // The other person owes 40% rounded down (4.00); the payer keeps the rest (6.01).
    expect(balanceCents(await getSplitTotals(db))).toBe(400);
    expect(await spentIn(fun)).toBe(601);

    await shared(fun, 1001, 'adriana', 60);
    // Now the owner owes 60% rounded down (6.00): 4.00 - 6.00.
    expect(balanceCents(await getSplitTotals(db))).toBe(-200);
    expect(await spentIn(fun)).toBe(1201);
  });

  it('editing keeps the split unless a new one is given', async () => {
    const fun = await idOf('Fun');
    const id = await shared(fun, 10000, 'sergio', 70);
    await updateExpense(db, id, { categoryId: fun, amountCents: 20000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'shared' });
    expect((await listExpenses(db, '2026-10'))[0].ownerSharePct).toBe(70);
    expect(balanceCents(await getSplitTotals(db))).toBe(6000);

    await updateExpense(db, id, { categoryId: fun, amountCents: 20000, spentOn: '2026-10-05', paidBy: 'sergio', forWhom: 'shared', ownerSharePct: 50 });
    expect(balanceCents(await getSplitTotals(db))).toBe(10000);
  });

  it('refuses a share outside 0 to 100', async () => {
    const fun = await idOf('Fun');
    await expect(shared(fun, 10000, 'sergio', 101)).rejects.toThrow(/CHECK/);
  });

  it('shared refunds have their own split', async () => {
    const fun = await idOf('Fun');
    await saveMonthPlan(db, { month: '2026-10', budgets: [{ categoryId: fun, amountCents: 100000 }] });
    await shared(fun, 20000, 'sergio', 60);
    await addIncome(db, { amountCents: 10000, receivedOn: '2026-10-09', categoryId: fun, forWhom: 'shared', ownerSharePct: 60 });
    // Owed: 40% of 200.00 minus 40% of the 100.00 refund. Spent: 60% of each.
    expect(balanceCents(await getSplitTotals(db))).toBe(4000);
    expect(await spentIn(fun)).toBe(6000);
  });

  it('every line still adds up to the headline with mixed splits', async () => {
    const fun = await idOf('Fun');
    for (const [pct, amount, payer] of [[50, 8335, 'sergio'], [60, 1001, 'sergio'], [60, 4999, 'adriana'], [25, 333, 'adriana']] as const) {
      await shared(fun, amount, payer, pct);
    }
    const lines = (await listDebtExpenses(db)).map((e) => expenseDebt(e)!);
    const owedBy = (debtor: string) => lines.filter((l) => l.debtor === debtor).reduce((sum, l) => sum + l.cents, 0);
    expect(balanceCents(await getSplitTotals(db))).toBe(owedBy('adriana') - owedBy('sergio'));

    const spent = (await getMonthCategoryInputs(db, '2026-10')).find((c) => c.id === fun)!.spentCents;
    expect(spent).toBe((await listExpenses(db, '2026-10')).reduce((sum, e) => sum + ownerShareCents(e), 0));
  });

  it('expenses from before the upgrade are half and half', async () => {
    db = createTestDb();
    await migrate(db, 11);
    const fun = (await db.getFirstAsync<{ id: string }>("SELECT id FROM categories WHERE name = 'Fun'", []))!.id;
    await db.runAsync(
      `INSERT INTO expenses (id, category_id, amount_cents, spent_on, paid_by, for_whom, created_at, updated_at)
       VALUES ('e1', ?, 10000, '2026-10-01', 'sergio', 'shared', 'x', 'x')`,
      [fun],
    );
    await migrate(db);
    expect((await listExpenses(db, '2026-10'))[0].ownerSharePct).toBe(50);
    expect(balanceCents(await getSplitTotals(db))).toBe(5000);
  });

  it('travels with a backup, and an old backup restores as half and half', async () => {
    const fun = await idOf('Fun');
    await shared(fun, 10000, 'sergio', 60);
    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);

    db = createTestDb();
    await migrate(db);
    await restoreBackup(db, parsed.backup);
    expect(balanceCents(await getSplitTotals(db))).toBe(4000);

    // A backup from before this existed has no such column on its rows.
    parsed.backup.tables.expenses = parsed.backup.tables.expenses.map(({ owner_share_pct, ...rest }) => rest);
    db = createTestDb();
    await migrate(db);
    await restoreBackup(db, parsed.backup);
    expect(balanceCents(await getSplitTotals(db))).toBe(5000);
  });
});
