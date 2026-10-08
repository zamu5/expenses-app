import { create } from 'zustand';

import { NO_SPLIT_FILTER, type Person, type SplitFilter } from '@/domain/split';
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
  /** Who paid / who it was for, on the Expenses tab. Kept here so it survives switching tabs. */
  expenseFilter: SplitFilter;
  setExpenseFilter: (filter: Partial<SplitFilter>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedMonth: monthKeyOf(todayISO()),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
  shiftSelectedMonth: (delta) => set((s) => ({ selectedMonth: shiftMonth(s.selectedMonth, delta) })),
  lastPaidBy: 'sergio',
  setLastPaidBy: (person) => set({ lastPaidBy: person }),
  expenseFilter: NO_SPLIT_FILTER,
  setExpenseFilter: (filter) => set((s) => ({ expenseFilter: { ...s.expenseFilter, ...filter } })),
}));
