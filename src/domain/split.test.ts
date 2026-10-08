import { balanceCents, describeBalance, type SplitTotals } from './split';

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
