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
    const id = await account('Chequing', 'CAD', 214498);
    // Put the database back to how version 5 could look, then run the pending migration.
    await db.runAsync('UPDATE accounts SET is_budget_account = 1 WHERE id = ?', [id]);
    await db.execAsync('ALTER TABLE months DROP COLUMN expected_income_cents; PRAGMA user_version = 5');
    await migrate(db);

    const row = await db.getFirstAsync<{ is_budget_account: number }>(
      'SELECT is_budget_account FROM accounts WHERE id = ?',
      [id],
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

describe('include in starting balance', () => {
  it('is on by default and can be switched off per account', async () => {
    const id = await createAccount(db, { name: 'Investments', kind: 'account', currency: 'CAD', balanceCents: 1000000, balanceUpdatedOn: '2026-10-07' });
    expect((await listAccounts(db))[0].includeInStart).toBe(true);

    await updateAccount(db, id, { name: 'Investments', kind: 'account', currency: 'CAD', balanceCents: 1000000, includeInStart: false, balanceUpdatedOn: '2026-10-07' });
    expect((await listAccounts(db))[0].includeInStart).toBe(false);
  });

  it('survives a backup and restore', async () => {
    await createAccount(db, { name: 'Off', kind: 'account', currency: 'CAD', balanceCents: 1, includeInStart: false, balanceUpdatedOn: '2026-10-07' });
    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreBackup(db, parsed.backup);
    expect((await listAccounts(db))[0].includeInStart).toBe(false);
  });

  it('is switched on for accounts that existed before the flag', async () => {
    // A backup from schema 4 has no include_in_start column; restoring fills in the default.
    const parsed = parseBackup(JSON.stringify(await exportBackup(db)), LATEST_SCHEMA_VERSION);
    if (!parsed.ok) throw new Error(parsed.error);
    parsed.backup.tables.accounts = [
      { id: 'old', name: 'Old', kind: 'account', currency: 'CAD', balance_cents: 5, is_budget_account: 0, balance_updated_on: '2026-10-01', sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null },
    ];
    await restoreBackup(db, parsed.backup);
    expect((await listAccounts(db))[0]).toMatchObject({ name: 'Old', includeInStart: true });
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
