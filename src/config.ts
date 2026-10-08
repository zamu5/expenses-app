/**
 * App-wide settings. Change CURRENCY to your own ISO 4217 code ('EUR', 'COP', 'MXN', ...).
 * Amounts are stored in cents regardless of currency, so changing this only affects display.
 */
export const CURRENCY = 'USD';

/** Display names of the two people who share expenses, keyed by the id stored in the database. */
export const PEOPLE = { sergio: 'Sergio', adriana: 'Adriana' } as const;
