import {
  balanceCents,
  describeBalance,
  matchesSplitFilter,
  NO_SPLIT_FILTER,
  ownerShareCents,
  type SplitTotals,
} from './split';

const totals = (over: Partial<SplitTotals> = {}): SplitTotals => ({
  sharedPaidBy: { sergio: 0, adriana: 0 },
  paidForOtherBy: { sergio: 0, adriana: 0 },
  settledBy: { sergio: 0, adriana: 0 },
  ...over,
});

describe('balanceCents (what Adriana owes Sergio)', () => {
  it('is zero when nothing was shared', () => {
    expect(balanceCents(totals())).toBe(0);
  });

  it('splits shared expenses 50/50', () => {
    expect(balanceCents(totals({ sharedPaidBy: { sergio: 10000, adriana: 0 } }))).toBe(5000);
    expect(balanceCents(totals({ sharedPaidBy: { sergio: 0, adriana: 10000 } }))).toBe(-5000);
    expect(balanceCents(totals({ sharedPaidBy: { sergio: 10000, adriana: 4000 } }))).toBe(3000);
  });

  it('owes in full what one person paid for the other', () => {
    expect(balanceCents(totals({ paidForOtherBy: { sergio: 2500, adriana: 0 } }))).toBe(2500);
    expect(balanceCents(totals({ paidForOtherBy: { sergio: 0, adriana: 2500 } }))).toBe(-2500);
  });

  it('settling up brings the balance back to zero', () => {
    expect(
      balanceCents(
        totals({ sharedPaidBy: { sergio: 10000, adriana: 0 }, settledBy: { sergio: 0, adriana: 5000 } }),
      ),
    ).toBe(0);
    expect(
      balanceCents(
        totals({ paidForOtherBy: { sergio: 0, adriana: 3000 }, settledBy: { sergio: 3000, adriana: 0 } }),
      ),
    ).toBe(0);
  });

  it('rounds an odd shared total once', () => {
    expect(balanceCents(totals({ sharedPaidBy: { sergio: 1001, adriana: 0 } }))).toBe(501);
  });
});

describe('describeBalance', () => {
  it('names the debtor and the creditor', () => {
    expect(describeBalance(0)).toBeNull();
    expect(describeBalance(700)).toEqual({ debtor: 'adriana', creditor: 'sergio', amountCents: 700 });
    expect(describeBalance(-700)).toEqual({ debtor: 'sergio', creditor: 'adriana', amountCents: 700 });
  });
});

describe('ownerShareCents', () => {
  it('counts half of what was shared and all of what was only for the owner', () => {
    // Gas: budget 100, one shared expense of 83.34 -> 41.67 counts, 58.33 is left.
    expect(ownerShareCents(0, 8334)).toBe(4167);
    expect(ownerShareCents(2500, 8334)).toBe(6667);
    expect(ownerShareCents(2500, 0)).toBe(2500);
    expect(ownerShareCents(0, 0)).toBe(0);
  });

  it('rounds the half once, on the total', () => {
    expect(ownerShareCents(0, 1001)).toBe(501);
  });
});

describe('matchesSplitFilter', () => {
  const sergioShared = { paidBy: 'sergio', forWhom: 'shared' } as const;
  const adrianaShared = { paidBy: 'adriana', forWhom: 'shared' } as const;
  const adrianaForSergio = { paidBy: 'adriana', forWhom: 'sergio' } as const;
  const all = [sergioShared, adrianaShared, adrianaForSergio];
  const keep = (filter: Parameters<typeof matchesSplitFilter>[1]) =>
    all.filter((e) => matchesSplitFilter(e, filter));

  it('lets everything through with no filter', () => {
    expect(keep(NO_SPLIT_FILTER)).toEqual(all);
  });

  it('filters by who paid, whoever it was for', () => {
    expect(keep({ paidBy: 'sergio', forWhom: 'all' })).toEqual([sergioShared]);
    expect(keep({ paidBy: 'adriana', forWhom: 'all' })).toEqual([adrianaShared, adrianaForSergio]);
  });

  it('filters by who it was for, whoever paid', () => {
    expect(keep({ paidBy: 'all', forWhom: 'shared' })).toEqual([sergioShared, adrianaShared]);
    expect(keep({ paidBy: 'all', forWhom: 'sergio' })).toEqual([adrianaForSergio]);
    expect(keep({ paidBy: 'all', forWhom: 'adriana' })).toEqual([]);
  });

  it('combines both: shared expenses that Adriana paid', () => {
    expect(keep({ paidBy: 'adriana', forWhom: 'shared' })).toEqual([adrianaShared]);
  });
});
