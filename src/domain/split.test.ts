import {
  balanceCents,
  describeBalance,
  expenseDebt,
  matchesSplitFilter,
  NO_SPLIT_FILTER,
  ownerShareCents,
  sharedHalfOwedCents,
  type SplitTotals,
} from './split';

const totals = (over: Partial<SplitTotals> = {}): SplitTotals => ({
  sharedPaidBy: { sergio: 0, adriana: 0 },
  sharedOwedTo: { sergio: 0, adriana: 0 },
  paidForOtherBy: { sergio: 0, adriana: 0 },
  settledBy: { sergio: 0, adriana: 0 },
  ...over,
});

describe('balanceCents (what Adriana owes Sergio)', () => {
  it('is zero when nothing was shared', () => {
    expect(balanceCents(totals())).toBe(0);
  });

  it('splits shared expenses 50/50', () => {
    expect(balanceCents(totals({ sharedOwedTo: { sergio: 5000, adriana: 0 } }))).toBe(5000);
    expect(balanceCents(totals({ sharedOwedTo: { sergio: 0, adriana: 5000 } }))).toBe(-5000);
    expect(balanceCents(totals({ sharedOwedTo: { sergio: 5000, adriana: 2000 } }))).toBe(3000);
  });

  it('owes in full what one person paid for the other', () => {
    expect(balanceCents(totals({ paidForOtherBy: { sergio: 2500, adriana: 0 } }))).toBe(2500);
    expect(balanceCents(totals({ paidForOtherBy: { sergio: 0, adriana: 2500 } }))).toBe(-2500);
  });

  it('settling up brings the balance back to zero', () => {
    expect(
      balanceCents(
        totals({ sharedOwedTo: { sergio: 5000, adriana: 0 }, settledBy: { sergio: 0, adriana: 5000 } }),
      ),
    ).toBe(0);
    expect(
      balanceCents(
        totals({ paidForOtherBy: { sergio: 0, adriana: 3000 }, settledBy: { sergio: 3000, adriana: 0 } }),
      ),
    ).toBe(0);
  });

});

describe('describeBalance', () => {
  it('names the debtor and the creditor', () => {
    expect(describeBalance(0)).toBeNull();
    expect(describeBalance(700)).toEqual({ debtor: 'adriana', creditor: 'sergio', amountCents: 700 });
    expect(describeBalance(-700)).toEqual({ debtor: 'sergio', creditor: 'adriana', amountCents: 700 });
  });
});

describe('sharedHalfOwedCents', () => {
  it('is exactly half of an even amount', () => {
    expect(sharedHalfOwedCents(8334)).toBe(4167);
    expect(sharedHalfOwedCents(0)).toBe(0);
  });

  it('leaves the odd cent with whoever paid', () => {
    expect(sharedHalfOwedCents(8335)).toBe(4167);
    expect(sharedHalfOwedCents(1)).toBe(0);
  });
});

describe('ownerShareCents', () => {
  const share = (amountCents: number, paidBy: 'sergio' | 'adriana', forWhom: 'shared' | 'sergio' | 'adriana') =>
    ownerShareCents({ amountCents, paidBy, forWhom });

  it('counts half of what was shared, whoever paid', () => {
    // Gas: budget 100, one shared expense of 83.34 -> 41.67 counts, 58.33 is left.
    expect(share(8334, 'sergio', 'shared')).toBe(4167);
    expect(share(8334, 'adriana', 'shared')).toBe(4167);
  });

  it('counts all of what was only for the owner and none of what was only for the other', () => {
    expect(share(2500, 'sergio', 'sergio')).toBe(2500);
    expect(share(2500, 'adriana', 'sergio')).toBe(2500);
    expect(share(2500, 'sergio', 'adriana')).toBe(0);
    expect(share(2500, 'adriana', 'adriana')).toBe(0);
  });

  it('gives the odd cent to whoever paid', () => {
    expect(share(8335, 'sergio', 'shared')).toBe(4168);
    expect(share(8335, 'adriana', 'shared')).toBe(4167);
  });

  it('plus what the other person owes is always the full amount the owner paid', () => {
    for (const amountCents of [8334, 8335, 1, 99999]) {
      const e = { amountCents, paidBy: 'sergio', forWhom: 'shared' } as const;
      expect(ownerShareCents(e) + expenseDebt(e)!.cents).toBe(amountCents);
    }
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

describe('expenseDebt', () => {
  it('is half for a shared expense, owed by whoever did not pay', () => {
    expect(expenseDebt({ amountCents: 8334, paidBy: 'sergio', forWhom: 'shared' })).toEqual({ debtor: 'adriana', cents: 4167 });
    expect(expenseDebt({ amountCents: 3000, paidBy: 'adriana', forWhom: 'shared' })).toEqual({ debtor: 'sergio', cents: 1500 });
    // The odd cent stays with the payer.
    expect(expenseDebt({ amountCents: 8335, paidBy: 'sergio', forWhom: 'shared' })).toEqual({ debtor: 'adriana', cents: 4167 });
  });

  it('is the full amount when one person paid something only for the other', () => {
    expect(expenseDebt({ amountCents: 2500, paidBy: 'sergio', forWhom: 'adriana' })).toEqual({ debtor: 'adriana', cents: 2500 });
    expect(expenseDebt({ amountCents: 2500, paidBy: 'adriana', forWhom: 'sergio' })).toEqual({ debtor: 'sergio', cents: 2500 });
  });

  it('is nothing when someone paid for themselves', () => {
    expect(expenseDebt({ amountCents: 2500, paidBy: 'sergio', forWhom: 'sergio' })).toBeNull();
    expect(expenseDebt({ amountCents: 2500, paidBy: 'adriana', forWhom: 'adriana' })).toBeNull();
  });
});
