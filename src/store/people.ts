import { create } from 'zustand';

import { DEFAULT_PEOPLE_NAMES, type PeopleNames } from '@/db/repositories/settings';
import { DEFAULT_OWNER_SHARE_PCT } from '@/domain/split';

/**
 * The two display names and how shared expenses are divided, loaded from the database when the
 * app starts (see PeopleLoader in the root layout) and again whenever they are changed. Kept in
 * a store so every screen can show them without each running its own query.
 */
interface PeopleState {
  names: PeopleNames;
  /** The owner's share of a new shared expense, in percent. */
  ownerSharePct: number;
  set: (state: { names: PeopleNames; ownerSharePct: number }) => void;
}

export const usePeopleStore = create<PeopleState>((set) => ({
  names: DEFAULT_PEOPLE_NAMES,
  ownerSharePct: DEFAULT_OWNER_SHARE_PCT,
  set: (state) => set(state),
}));

/** The names to show for the two people, e.g. `people.sergio`. */
export function usePeople(): PeopleNames {
  return usePeopleStore((s) => s.names);
}

/** The owner's share of a new shared expense, in percent. */
export function useOwnerSharePct(): number {
  return usePeopleStore((s) => s.ownerSharePct);
}

/** "60/40": the owner's share first. */
export const splitRatioLabel = (ownerSharePct: number) => `${ownerSharePct}/${100 - ownerSharePct}`;
