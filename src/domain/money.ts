/**
 * Money is always an integer number of cents (minor units).
 * Floats are never used for arithmetic: 0.1 + 0.2 !== 0.3 in binary floating point.
 */
export type Cents = number;

/**
 * Parses what the user typed ("12", "12.5", "12,50", "1,234.56") into cents.
 * Returns null when the text is not a valid non-negative amount with at most 2 decimals.
 */
export function parseAmountToCents(input: string): Cents | null {
  const trimmed = input.trim().replace(/\s/g, '');
  if (trimmed === '') return null;

  // Treat the last "," or "." as the decimal separator when it is followed by 1–2 digits;
  // every other separator is a thousands separator and is dropped.
  const match = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const wholePart = match[1].replace(/[.,]/g, '');
  const fraction = match[2] ?? '';
  if (!/^\d+$/.test(wholePart) && !(wholePart === '' && fraction !== '')) return null;

  const whole = wholePart === '' ? 0 : Number(wholePart);
  const cents = Number(fraction.padEnd(2, '0'));
  const total = whole * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** Turns cents back into the plain editable text used by inputs: 1250 -> "12.50". */
export function centsToInputText(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Formats cents for display with the currency symbol, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: Cents, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/**
 * Takes a part out of a total, for an expense that belongs to two categories: 100.00 with 35.00
 * for another category leaves 65.00. Null unless the part is more than zero and less than the
 * total, so both sides keep a real amount.
 */
export function splitOffPart(
  totalCents: Cents,
  partCents: Cents,
): { restCents: Cents; partCents: Cents } | null {
  if (!Number.isInteger(partCents) || partCents <= 0 || partCents >= totalCents) return null;
  return { restCents: totalCents - partCents, partCents };
}
