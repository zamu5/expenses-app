import { daysElapsed, daysInMonth, shiftDay, shiftMonth } from './dates';

describe('dates', () => {
  it('knows month lengths, including leap years', () => {
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('shifts days across month ends', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts elapsed days for past, current and future months', () => {
    expect(daysElapsed('2026-09', '2026-10-07')).toBe(30);
    expect(daysElapsed('2026-10', '2026-10-07')).toBe(7);
    expect(daysElapsed('2026-11', '2026-10-07')).toBe(0);
  });
});
