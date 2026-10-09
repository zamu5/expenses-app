import {
  balanceCents,
  describeBalance,
  expenseDebt,
  matchesSplitFilter,
  NO_SPLIT_FILTER,
  ownerShareCents,
  refundOwedToOtherCents,
  refundOwnerShareCents,
  shareCents,
  type SplitTotals,
} from './split';

const totals = (over: Partial<SplitTotals> = {}): SplitTotals => ({
  sharedPaidBy: { sergio: 0, adriana: 0 },
  sharedOwedTo: { sergio: 0, adriana: 0 },
  paidForOtherBy: { sergio: 0, adriana: 0 },
  settledBy: { sergio: 0, adriana: 0 },
  refundsOwedToOther: 0,
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

describe('shareCents', () => {
  it('is exactly half of an even amount at 50%', () => {
    expect(shareCents(8334, 50)).toBe(4167);
    expect(shareCents(0, 50)).toBe(0);
  });

  it('rounds down, so the odd cent stays with whoever paid', () => {
    expect(shareCents(8335, 50)).toBe(4167);
    expect(shareCents(1, 50)).toBe(0);
    expect(shareCents(1001, 40)).toBe(400);
  });

  it('handles the extremes', () => {
    expect(shareCents(8335, 0)).toBe(0);
    expect(shareCents(8335, 100)).toBe(8335);
  });
});

describe('a split other than half and half', () => {
  // The owner takes 60% of shared expenses, the other person 40%.
  const at60 = (amountCents: number, paidBy: 'sergio' | 'adriana') =>
    ({ amountCents, paidBy, forWhom: 'shared', ownerSharePct: 60 }) as const;

  it('owner paid: the other person owes their 40%', () => {
    expect(expenseDebt(at60(10000, 'sergio'))).toEqual({ debtor: 'adriana', cents: 4000 });
    expect(ownerShareCents(at60(10000, 'sergio'))).toBe(6000);
  });

  it('other person paid: the owner owes their 60%', () => {
    expect(expenseDebt(at60(10000, 'adriana'))).toEqual({ debtor: 'sergio', cents: 6000 });
    expect(ownerShareCents(at60(10000, 'adriana'))).toBe(6000);
  });

  it('keeps the odd cent with the payer, each way', () => {
    // 10.01: 40% is 4.004 and 60% is 6.006; the debtor's part is rounded down.
    expect(expenseDebt(at60(1001, 'sergio'))).toEqual({ debtor: 'adriana', cents: 400 });
    expect(ownerShareCents(at60(1001, 'sergio'))).toBe(601);
    expect(expenseDebt(at60(1001, 'adriana'))).toEqual({ debtor: 'sergio', cents: 600 });
    expect(ownerShareCents(at60(1001, 'adriana'))).toBe(600);
  });

  it('the share and the debt always add up to what the owner paid', () => {
    for (const pct of [0, 33, 50, 60, 100]) {
      for (const amountCents of [1, 999, 1001, 8335]) {
        const e = { amountCents, paidBy: 'sergio', forWhom: 'shared', ownerSharePct: pct } as const;
        expect(ownerShareCents(e) + expenseDebt(e)!.cents).toBe(amountCents);
      }
    }
  });

  it('applies to refunds too', () => {
    const refund = { amountCents: 1001, forWhom: 'shared', ownerSharePct: 60 } as const;
    expect(refundOwedToOtherCents(refund)).toBe(400);
    expect(refundOwnerShareCents(refund)).toBe(601);
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

describe('refunds', () => {
  it('a shared refund gives half back to each', () => {
    expect(refundOwedToOtherCents({ amountCents: 10000, forWhom: 'shared' })).toBe(5000);
    expect(refundOwnerShareCents({ amountCents: 10000, forWhom: 'shared' })).toBe(5000);
    // The odd cent stays with the owner, who received the money.
    expect(refundOwedToOtherCents({ amountCents: 1001, forWhom: 'shared' })).toBe(500);
    expect(refundOwnerShareCents({ amountCents: 1001, forWhom: 'shared' })).toBe(501);
  });

  it('a refund only for the owner lowers only their spending', () => {
    expect(refundOwedToOtherCents({ amountCents: 4000, forWhom: 'sergio' })).toBe(0);
    expect(refundOwnerShareCents({ amountCents: 4000, forWhom: 'sergio' })).toBe(4000);
  });

  it('a refund only for the other person is owed to them in full', () => {
    expect(refundOwedToOtherCents({ amountCents: 4000, forWhom: 'adriana' })).toBe(4000);
    expect(refundOwnerShareCents({ amountCents: 4000, forWhom: 'adriana' })).toBe(0);
  });

  it('lowers what the other person owes', () => {
    expect(balanceCents(totals({ sharedOwedTo: { sergio: 10000, adriana: 0 }, refundsOwedToOther: 5000 }))).toBe(5000);
  });
});
