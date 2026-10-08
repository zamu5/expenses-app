/**
 * App-wide settings. CURRENCY is your home currency as an ISO 4217 code ('CAD', 'EUR', 'COP', ...):
 * the budget is in it, and the Accounts tab converts every other currency to it for the total.
 * Amounts are stored in cents regardless of currency, so changing this only affects display.
 */
export const CURRENCY = 'CAD';

/** Display names of the two people who share expenses, keyed by the id stored in the database. */
export const PEOPLE = { sergio: 'Sergio', adriana: 'Adriana' } as const;
