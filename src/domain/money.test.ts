import { centsToInputText, parseAmountToCents } from './money';

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
