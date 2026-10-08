import { computeNetWorth, parseCurrencyCode, toHomeCents } from './accounts';

describe('toHomeCents', () => {
  it('converts with a typed rate and rounds to the cent', () => {
    // 1 CAD = 2950 COP, so 1,000,000.00 COP is 338.98 CAD.
    expect(toHomeCents(100000000, 2950)).toBe(33898);
    expect(toHomeCents(-100000000, 2950)).toBe(-33898);
  });
});

describe('computeNetWorth', () => {
  it('adds accounts and subtracts planned expenses', () => {
    const result = computeNetWorth(
      [
        { kind: 'account', currency: 'CAD', balanceCents: 250000 },
        { kind: 'account', currency: 'CAD', balanceCents: 1000000 },
        { kind: 'planned', currency: 'CAD', balanceCents: 300000 },
      ],
      {},
      'CAD',
    );
    expect(result.currencies).toEqual([
      { currency: 'CAD', accountsCents: 1250000, plannedCents: 300000, netCents: 950000, netHomeCents: 950000 },
    ]);
    expect(result.totalHomeCents).toBe(950000);
    expect(result.missingRates).toEqual([]);
  });

  it('converts other currencies to the home currency, home first', () => {
    const result = computeNetWorth(
      [
        { kind: 'account', currency: 'COP', balanceCents: 500000000 },
        { kind: 'account', currency: 'COP', balanceCents: 90000000 },
        { kind: 'account', currency: 'CAD', balanceCents: 100000 },
      ],
      { COP: 2950 },
      'CAD',
    );
    expect(result.currencies.map((c) => c.currency)).toEqual(['CAD', 'COP']);
    expect(result.currencies[1]).toMatchObject({ netCents: 590000000, netHomeCents: 200000 });
    expect(result.totalHomeCents).toBe(300000);
  });

  it('leaves a currency without a rate out of the total and flags it', () => {
    const result = computeNetWorth(
      [
        { kind: 'account', currency: 'CAD', balanceCents: 100000 },
        { kind: 'account', currency: 'COP', balanceCents: 500000000 },
      ],
      {},
      'CAD',
    );
    expect(result.totalHomeCents).toBe(100000);
    expect(result.missingRates).toEqual(['COP']);
    expect(result.currencies[1].netHomeCents).toBeNull();
  });

  it('can go negative when planned expenses exceed the accounts', () => {
    const result = computeNetWorth(
      [
        { kind: 'account', currency: 'CAD', balanceCents: 1000 },
        { kind: 'planned', currency: 'CAD', balanceCents: 5000 },
      ],
      {},
      'CAD',
    );
    expect(result.totalHomeCents).toBe(-4000);
  });

  it('is empty with no accounts', () => {
    expect(computeNetWorth([], {}, 'CAD')).toEqual({ currencies: [], totalHomeCents: 0, missingRates: [] });
  });
});

describe('parseCurrencyCode', () => {
  it('accepts three letters in any case', () => {
    expect(parseCurrencyCode(' cop ')).toBe('COP');
    expect(parseCurrencyCode('CAD')).toBe('CAD');
  });
  it('rejects anything else', () => {
    expect(parseCurrencyCode('')).toBeNull();
    expect(parseCurrencyCode('pesos')).toBeNull();
    expect(parseCurrencyCode('C$')).toBeNull();
  });
});
