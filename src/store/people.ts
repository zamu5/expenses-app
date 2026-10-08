import { create } from 'zustand';

import { DEFAULT_PEOPLE_NAMES, type PeopleNames } from '@/db/repositories/settings';

/**
 * The two display names, loaded from the database when the app starts (see PeopleLoader in the
 * root layout) and again whenever they are changed. Kept in a store so every screen can show
 * them without each running its own query.
 */
interface PeopleState {
  names: PeopleNames;
  setNames: (names: PeopleNames) => void;
}

export const usePeopleStore = create<PeopleState>((set) => ({
  names: DEFAULT_PEOPLE_NAMES,
  setNames: (names) => set({ names }),
}));

/** The names to show for the two people, e.g. `people.sergio`. */
export function usePeople(): PeopleNames {
  return usePeopleStore((s) => s.names);
}
