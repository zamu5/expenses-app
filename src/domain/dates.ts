/**
 * Dates are stored as plain strings: a day is 'YYYY-MM-DD' and a month is 'YYYY-MM'.
 * Plain strings avoid time-zone surprises and sort correctly as text.
 */
export type ISODate = string; // '2026-10-07'
export type MonthKey = string; // '2026-10'

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the phone's local time zone. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthKeyOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function daysInMonth(month: MonthKey): number {
  const [year, m] = month.split('-').map(Number);
  // Day 0 of the next month is the last day of this month.
  return new Date(year, m, 0).getDate();
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftDay(date: ISODate, delta: number): ISODate {
  const [year, m, day] = date.split('-').map(Number);
  return todayISO(new Date(year, m - 1, day + delta));
}

/**
 * How many days of `month` have passed, counting today.
 * A future month has 0 elapsed days; a past month has all of them.
 */
export function daysElapsed(month: MonthKey, today: ISODate): number {
  const current = monthKeyOf(today);
  if (month > current) return 0;
  if (month < current) return daysInMonth(month);
  return Number(today.slice(8, 10));
}

/** 'October 2026' */
export function formatMonth(month: MonthKey, locale?: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(year, m - 1, 1),
  );
}

/** 'Tue, Oct 7' */
export function formatDay(date: ISODate, locale?: string): string {
  const [year, m, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(year, m - 1, day),
  );
}
