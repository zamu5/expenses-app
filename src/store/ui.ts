import { create } from 'zustand';

import { monthKeyOf, shiftMonth, todayISO, type MonthKey } from '@/domain/dates';

/**
 * UI state shared by several screens. Only the selected month lives here:
 * all real data (expenses, budgets, categories) lives in SQLite and is read with useDbQuery().
 */
interface UiState {
  selectedMonth: MonthKey;
  setSelectedMonth: (month: MonthKey) => void;
  shiftSelectedMonth: (delta: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedMonth: monthKeyOf(todayISO()),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
  shiftSelectedMonth: (delta) => set((s) => ({ selectedMonth: shiftMonth(s.selectedMonth, delta) })),
}));
