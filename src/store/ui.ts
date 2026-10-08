import { create } from 'zustand';

import type { Person } from '@/domain/split';
import { monthKeyOf, shiftMonth, todayISO, type MonthKey } from '@/domain/dates';

/**
 * UI state shared by several screens: the selected month and who paid the last expense you added.
 * All real data (expenses, budgets, categories) lives in SQLite and is read with useDbQuery().
 */
interface UiState {
  selectedMonth: MonthKey;
  setSelectedMonth: (month: MonthKey) => void;
  shiftSelectedMonth: (delta: number) => void;
  /** Pre-selects "Paid by" on the next new expense. */
  lastPaidBy: Person;
  setLastPaidBy: (person: Person) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedMonth: monthKeyOf(todayISO()),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
  shiftSelectedMonth: (delta) => set((s) => ({ selectedMonth: shiftMonth(s.selectedMonth, delta) })),
  lastPaidBy: 'sergio',
  setLastPaidBy: (person) => set({ lastPaidBy: person }),
}));
