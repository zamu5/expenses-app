import { computeMonthSummary, summarizeCategory, type CategoryInput } from './budget';

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

  it('marks the month as watch when the projection falls below plan', () => {
    expect(summary.status).toBe('watch');
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
