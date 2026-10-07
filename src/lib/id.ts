import { randomUUID } from 'expo-crypto';

/**
 * UUIDs instead of auto-increment ids: records created on two devices can never collide,
 * which is what makes adding sync later possible.
 */
export function newId(): string {
  return randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
