import { centsToInputText, parseAmountToCents, splitOffPart } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12,50', 1250],
    ['0.99', 99],
    ['.5', 50],
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ['1,234', 123400],
    [' 7 ', 700],
  ])('parses %p as %p cents', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '12.345.x', '1.2.3a'])('rejects %p', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it('avoids floating point drift', () => {
    expect(parseAmountToCents('0.1')! + parseAmountToCents('0.2')!).toBe(30);
  });
});

describe('centsToInputText', () => {
  it('round-trips with parseAmountToCents', () => {
    expect(centsToInputText(123456)).toBe('1234.56');
    expect(parseAmountToCents(centsToInputText(5))).toBe(5);
  });
});

describe('splitOffPart', () => {
  it('leaves the rest in the first category', () => {
    expect(splitOffPart(20000, 5000)).toEqual({ restCents: 15000, partCents: 5000 });
    expect(splitOffPart(10001, 1)).toEqual({ restCents: 10000, partCents: 1 });
  });

  it('refuses a part that is zero, negative, the whole amount or more', () => {
    expect(splitOffPart(20000, 0)).toBeNull();
    expect(splitOffPart(20000, -5)).toBeNull();
    expect(splitOffPart(20000, 20000)).toBeNull();
    expect(splitOffPart(20000, 25000)).toBeNull();
  });
});
