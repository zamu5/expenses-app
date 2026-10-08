import {
  computeMonthSummary,
  explainMonthStatus,
  leftToSpendCents,
  summarizeCategory,
  type CategoryInput,
} from './budget';

// The worked example from the plan: October 2026, today is the 7th, starting with 3,000.00.
const october: CategoryInput[] = [
  { id: 'rent', name: 'Rent', isFixed: true, budgetCents: 120000, spentCents: 120000 },
  { id: 'groceries', name: 'Groceries', isFixed: false, budgetCents: 40000, spentCents: 12000 },
  { id: 'transport', name: 'Transport', isFixed: false, budgetCents: 15000, spentCents: 6000 },
  { id: 'fun', name: 'Fun', isFixed: false, budgetCents: 20000, spentCents: 3000 },
];

describe('computeMonthSummary', () => {
  const summary = computeMonthSummary({
    startingBalanceCents: 300000,
    categories: october,
    daysInMonth: 31,
    daysElapsed: 7,
  });

  it('computes the three balances from the plan', () => {
    expect(summary.totalSpentCents).toBe(141000);
    expect(summary.totalBudgetCents).toBe(195000);
    expect(summary.currentBalanceCents).toBe(159000);
    expect(summary.plannedEndCents).toBe(105000);
    expect(summary.projectedEndCents).toBe(87000);
  });

  it('is on track while the plan ends above zero and no category is over', () => {
    expect(summary.status).toBe('onTrack');
  });

  it('is watch as soon as one category is over its budget', () => {
    const over = october.map((c) => (c.id === 'fun' ? { ...c, spentCents: 25000 } : c));
    const result = computeMonthSummary({ startingBalanceCents: 300000, categories: over, daysInMonth: 31, daysElapsed: 7 });
    expect(result.status).toBe('watch');
  });

  it('is danger when even sticking to the budget ends below zero', () => {
    const result = computeMonthSummary({ startingBalanceCents: 100000, categories: october, daysInMonth: 31, daysElapsed: 7 });
    expect(result.status).toBe('danger');
  });

  it('gives each category the status from the plan', () => {
    const byId = Object.fromEntries(summary.categories.map((c) => [c.id, c]));
    expect(byId.rent.status).toBe('onTrack');
    expect(byId.rent.pace).toBeNull();
    expect(byId.groceries.status).toBe('watch');
    expect(byId.groceries.pace).toBeCloseTo(1.33, 2);
    expect(byId.groceries.projectedSpendCents).toBe(53143);
    expect(byId.transport.status).toBe('watch');
    expect(byId.fun.status).toBe('onTrack');
  });

  it('is danger when the projection goes below zero', () => {
    const s = computeMonthSummary({
      startingBalanceCents: 50000,
      categories: october,
      daysInMonth: 31,
      daysElapsed: 7,
    });
    expect(s.status).toBe('danger');
  });

  it('flags the first days of the month as an early estimate', () => {
    const s = computeMonthSummary({ startingBalanceCents: 0, categories: [], daysInMonth: 31, daysElapsed: 2 });
    expect(s.isEarlyEstimate).toBe(true);
  });
});

describe('summarizeCategory', () => {
  const groceries = october[1];

  it('marks a category over budget as over', () => {
    const c = summarizeCategory({ ...groceries, spentCents: 45000 }, 31, 20);
    expect(c.status).toBe('over');
    expect(c.remainingCents).toBe(-5000);
  });

  it('uses actual spending once the month is over', () => {
    const c = summarizeCategory(groceries, 31, 31);
    expect(c.projectedSpendCents).toBe(12000);
  });

  it('assumes the full budget for a future month', () => {
    const c = summarizeCategory({ ...groceries, spentCents: 0 }, 31, 0);
    expect(c.projectedSpendCents).toBe(40000);
    expect(c.pace).toBeNull();
  });

  it('treats spending in a category with no budget as over', () => {
    const c = summarizeCategory({ ...groceries, budgetCents: 0 }, 31, 7);
    expect(c.status).toBe('over');
  });

  it('never projects a fixed cost below its budget', () => {
    const rent = summarizeCategory({ ...october[0], spentCents: 0 }, 31, 7);
    expect(rent.projectedSpendCents).toBe(120000);
  });
});

describe('income', () => {
  it('raises the current, planned and projected balances', () => {
    const without = computeMonthSummary({ startingBalanceCents: 300000, categories: october, daysInMonth: 31, daysElapsed: 7 });
    const withSalary = computeMonthSummary({
      startingBalanceCents: 300000,
      incomeCents: 250000,
      categories: october,
      daysInMonth: 31,
      daysElapsed: 7,
    });
    expect(without.totalIncomeCents).toBe(0);
    expect(withSalary.totalIncomeCents).toBe(250000);
    expect(withSalary.currentBalanceCents).toBe(without.currentBalanceCents + 250000);
    expect(withSalary.plannedEndCents).toBe(without.plannedEndCents + 250000);
    expect(withSalary.projectedEndCents).toBe(without.projectedEndCents + 250000);
    expect(withSalary.totalSpentCents).toBe(without.totalSpentCents);
  });

  it('can turn a month that was heading below zero back on track', () => {
    const tight = { startingBalanceCents: 100000, categories: october, daysInMonth: 31, daysElapsed: 7 };
    expect(computeMonthSummary(tight).status).toBe('danger');
    expect(computeMonthSummary({ ...tight, incomeCents: 300000 }).status).not.toBe('danger');
  });
});

describe('leftToSpendCents', () => {
  it('adds what is left in each category', () => {
    // rent 0 + groceries 280 + transport 90 + fun 170
    expect(leftToSpendCents(october)).toBe(54000);
  });

  it('does not let an overspent category cancel out another', () => {
    expect(
      leftToSpendCents([
        { budgetCents: 10000, spentCents: 15000 },
        { budgetCents: 10000, spentCents: 4000 },
      ]),
    ).toBe(6000);
  });

  it('is zero with no categories', () => {
    expect(leftToSpendCents([])).toBe(0);
  });
});

describe('expected income', () => {
  const base = { startingBalanceCents: 300000, categories: october, daysInMonth: 31, daysElapsed: 7 };

  it('counts toward the planned end before it is received', () => {
    const summary = computeMonthSummary({ ...base, expectedIncomeCents: 250000 });
    expect(summary.plannedEndCents).toBe(300000 + 250000 - 195000);
    // Not received yet, so it is not in the current balance.
    expect(summary.currentBalanceCents).toBe(159000);
    expect(summary.totalIncomeCents).toBe(0);
  });

  it('is not counted twice once the salary is logged', () => {
    const summary = computeMonthSummary({ ...base, expectedIncomeCents: 250000, incomeCents: 250000 });
    expect(summary.plannedEndCents).toBe(300000 + 250000 - 195000);
  });

  it('gives way to what was really received when that is more', () => {
    const summary = computeMonthSummary({ ...base, expectedIncomeCents: 250000, incomeCents: 260000 });
    expect(summary.plannedEndCents).toBe(300000 + 260000 - 195000);
  });
});

describe('explainMonthStatus', () => {
  const summarize = (categories: CategoryInput[], startingBalanceCents = 300000) =>
    computeMonthSummary({ startingBalanceCents, categories, daysInMonth: 31, daysElapsed: 7 });
  const format = (cents: number) => (cents / 100).toFixed(2);

  it('names the categories that are over budget and by how much', () => {
    const over = october.map((c) =>
      c.id === 'fun' ? { ...c, spentCents: 22300 } : c.id === 'transport' ? { ...c, spentCents: 15800 } : c,
    );
    expect(explainMonthStatus(summarize(over), format)).toBe(
      'Watch: over budget in Transport (by 8.00), Fun (by 23.00).',
    );
  });

  it('says how far below zero the planned end is', () => {
    // 1,000 to start with against 1,950 of budgets.
    expect(explainMonthStatus(summarize(october, 100000), format)).toMatch(/^Danger: .*below zero by 950\.00\./);
  });

  it('explains on track', () => {
    expect(explainMonthStatus(summarize(october), format)).toMatch(/^On track: /);
  });
});
