import { computeNetWorth, computeStartedWith, parseCurrencyCode, toHomeCents } from './accounts';

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

describe('computeStartedWith', () => {
  const account = (currency: string, balanceCents: number, includeInStart = true) => ({
    kind: 'account' as const,
    currency,
    balanceCents,
    includeInStart,
  });
  const accounts = [
    account('CAD', 214498),
    account('CAD', 1000000),
    account('COP', 295000000),
    account('COP', 295000000),
    { ...account('CAD', 300000), kind: 'planned' as const },
  ];

  it('adds the switched-on accounts and subtracts planned expenses', () => {
    // 2,144.98 + 10,000 + 1,000 + 1,000 (pesos at 2950) - 3,000
    expect(computeStartedWith(accounts, { COP: 2950 }, 'CAD').totalHomeCents).toBe(1114498);
  });

  it('leaves out an account that is switched off, but never a planned expense', () => {
    const switchedOff = accounts.map((a, i) => (i === 1 || i === 4 ? { ...a, includeInStart: false } : a));
    expect(computeStartedWith(switchedOff, { COP: 2950 }, 'CAD').totalHomeCents).toBe(114498);
  });

  it('flags a currency that has no rate', () => {
    const result = computeStartedWith(accounts, {}, 'CAD');
    expect(result.missingRates).toEqual(['COP']);
    expect(result.totalHomeCents).toBe(914498);
  });

  it('is zero with no accounts', () => {
    expect(computeStartedWith([], {}, 'CAD').totalHomeCents).toBe(0);
  });
});
