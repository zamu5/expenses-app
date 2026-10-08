import {
  balanceCents,
  budgetAccountCents,
  describeBalance,
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

describe('budgetAccountCents', () => {
  const flows = {
    startingBalanceCents: 300000,
    incomeCents: 0,
    paidByOwnerCents: 0,
    receivedFromOtherCents: 0,
    paidToOtherCents: 0,
  };

  it('takes out in full what the owner paid, and adds income', () => {
    expect(budgetAccountCents({ ...flows, incomeCents: 250000, paidByOwnerCents: 8334 })).toBe(541666);
  });

  it('moves with payments between the two people', () => {
    expect(budgetAccountCents({ ...flows, receivedFromOtherCents: 4167 })).toBe(304167);
    expect(budgetAccountCents({ ...flows, paidToOtherCents: 2000 })).toBe(298000);
  });

  it('together with what is owed, equals the budget view of the same month', () => {
    // Owner paid 83.34 shared: account is down 83.34, the other person owes 41.67,
    // and the budget says 41.67 was spent. 3000 - 83.34 + 41.67 = 3000 - 41.67.
    const account = budgetAccountCents({ ...flows, paidByOwnerCents: 8334 });
    const owed = balanceCents({
      sharedPaidBy: { sergio: 8334, adriana: 0 },
      paidForOtherBy: { sergio: 0, adriana: 0 },
      settledBy: { sergio: 0, adriana: 0 },
    });
    expect(account + owed).toBe(300000 - ownerShareCents(0, 8334));
  });
});
