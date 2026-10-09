import { create } from 'zustand';

/** What the automatic backup last did, shown in Settings. Not saved: it starts over with the app. */
export type AutoBackupStatus =
  | { state: 'off' }
  | { state: 'waiting' }
  | { state: 'saved'; at: string; file: string }
  | { state: 'failed'; at: string; error: string };

interface AutoBackupState {
  status: AutoBackupStatus;
  setStatus: (status: AutoBackupStatus) => void;
}

export const useAutoBackupStore = create<AutoBackupState>((set) => ({
  status: { state: 'waiting' },
  setStatus: (status) => set({ status }),
}));
