import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BalanceBetweenCard } from '@/components/balance-between-card';
import { MonthSwitcher } from '@/components/month-switcher';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { splitLabel } from '@/components/split-label';
import { Card, Chips, EmptyState, Fab, Money, Screen, SectionLabel, Title } from '@/components/ui';
import { listCategories } from '@/db/repositories/categories';
import { listExpenses } from '@/db/repositories/expenses';
import { listIncomes } from '@/db/repositories/incomes';
import type { Expense, Income } from '@/db/types';
import { formatDay } from '@/domain/dates';
import { matchesSplitFilter, type SplitFilter } from '@/domain/split';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';
import { usePeople } from '@/store/people';

const ALL = 'all';

export default function ExpensesScreen() {
  const people = usePeople();
  const theme = useTheme();
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const [filter, setFilter] = useState<string>(ALL);
  const splitFilter = useUiStore((s) => s.expenseFilter);
  const setSplitFilter = useUiStore((s) => s.setExpenseFilter);
  const isSplitFiltered = splitFilter.paidBy !== 'all' || splitFilter.forWhom !== 'all';
  const filtersOpen = useUiStore((s) => s.expenseFiltersOpen);
  const toggleFilters = useUiStore((s) => s.toggleExpenseFilters);

  const { data } = useDbQuery(
    async (db) => {
      const [expenses, categories, incomes] = await Promise.all([
        listExpenses(db, selectedMonth, filter === ALL ? undefined : filter),
        listCategories(db, { includeArchived: true }),
        listIncomes(db, selectedMonth),
      ]);
      return { expenses, categories, incomes };
    },
    [selectedMonth, filter],
  );

  const categoryName = new Map(data?.categories.map((c) => [c.id, c.name]));
  // What is filtered right now, shown next to "Filters" so it is visible while they are folded.
  const activeFilters = [
    filter === ALL ? null : (categoryName.get(filter) ?? null),
    splitFilter.paidBy === 'all' ? null : `Paid by ${people[splitFilter.paidBy]}`,
    splitFilter.forWhom === 'all'
      ? null
      : splitFilter.forWhom === 'shared'
        ? 'Shared'
        : `Only ${people[splitFilter.forWhom]}`,
  ].filter((label): label is string => label !== null);
  // The category filter is applied by the query; who paid / shared is applied here.
  const expenses = (data?.expenses ?? []).filter((e) => matchesSplitFilter(e, splitFilter));
  // Income has no payer, so it is hidden while a "paid by" or "for" filter is on. With a category
  // filter, only the refunds for that category stay.
  const incomes = isSplitFiltered
    ? []
    : (data?.incomes ?? []).filter((i) => filter === ALL || i.categoryId === filter);
  const days = groupByDay(expenses, incomes);
  const entries = days.flatMap(([, items]) => items);
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <ThemedView style={{ flex: 1 }}>
      <Screen tabs>
        <Title>Expenses</Title>
        <MonthSwitcher />

        <BalanceBetweenCard />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          onPress={toggleFilters}
          style={styles.between}>
          <ThemedText type="smallBold">
            Filters
            {activeFilters.length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`  ${activeFilters.join(' · ')}`}
              </ThemedText>
            ) : null}
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            {filtersOpen ? 'Hide' : 'Show'}
          </ThemedText>
        </Pressable>
        {filtersOpen ? (
          <>
            <SectionLabel>Category</SectionLabel>
            <Chips
              options={[
                { value: ALL, label: 'All' },
                ...(data?.categories ?? [])
                  .filter((c) => !c.archivedAt)
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={filter}
              onChange={setFilter}
            />
            <SectionLabel>Paid by</SectionLabel>
            <Chips<SplitFilter['paidBy']>
              options={[
                { value: 'all', label: 'All' },
                { value: 'sergio', label: people.sergio },
                { value: 'adriana', label: people.adriana },
              ]}
              value={splitFilter.paidBy}
              onChange={(paidBy) => setSplitFilter({ paidBy })}
            />
            <SectionLabel>For</SectionLabel>
            <Chips<SplitFilter['forWhom']>
              options={[
                { value: 'all', label: 'All' },
                { value: 'shared', label: 'Shared' },
                { value: 'sergio', label: `Only ${people.sergio}` },
                { value: 'adriana', label: `Only ${people.adriana}` },
              ]}
              value={splitFilter.forWhom}
              onChange={(forWhom) => setSplitFilter({ forWhom })}
            />
          </>
        ) : null}

        {/* Income has no category or payer, so it only shows when no filter is on. */}
        {data && entries.length === 0 ? (
          data.expenses.length === 0 && data.incomes.length === 0 ? (
            <EmptyState title="Nothing yet" body="Tap + to log what you spend." />
          ) : (
            <EmptyState title="Nothing matches" body="Nothing for this filter in this month." />
          )
        ) : null}

        {data && expenses.length > 0 ? (
          <View style={styles.between}>
            <ThemedText type="small" themeColor="textSecondary">
              {expenses.length} expenses
            </ThemedText>
            <Money cents={total} type="smallBold" />
          </View>
        ) : null}

        {days.map(([day, items]) => (
          <View key={day} style={{ gap: 6 }}>
            <View style={styles.between}>
              <SectionLabel>{formatDay(day)}</SectionLabel>
              {/* The day's total is what was spent; income and refunds are not netted into it. */}
              {items.some((item) => item.expense) ? (
                <Money
                  cents={items.reduce((sum, item) => sum + (item.expense?.amountCents ?? 0), 0)}
                  type="small"
                  color={theme.textSecondary}
                />
              ) : null}
            </View>
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {items.map((item, i) => {
                const rowStyle = ({ pressed }: { pressed: boolean }) => [
                  styles.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
                  { opacity: pressed ? 0.6 : 1 },
                ];
                if (item.income) {
                  const income = item.income;
                  const refundFor = income.categoryId ? categoryName.get(income.categoryId) : undefined;
                  return (
                    <Pressable
                      key={income.id}
                      onPress={() => router.push({ pathname: '/income', params: { id: income.id } })}
                      style={rowStyle}>
                      <View style={{ flex: 1 }}>
                        <ThemedText>{income.categoryId ? `Refund · ${refundFor ?? 'category'}` : 'Income'}</ThemedText>
                        {income.note ? (
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                            {income.note}
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText style={{ color: theme.good }}>+</ThemedText>
                      <Money cents={income.amountCents} color={theme.good} />
                    </Pressable>
                  );
                }
                const e = item.expense;
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => router.push({ pathname: '/expense', params: { id: e.id } })}
                    style={rowStyle}>
                    <View style={{ flex: 1 }}>
                      <ThemedText>{categoryName.get(e.categoryId) ?? 'Unknown'}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {splitLabel(e, people)}
                        {e.note ? ` · ${e.note}` : ''}
                      </ThemedText>
                    </View>
                    <Money cents={e.amountCents} />
                  </Pressable>
                );
              })}
            </Card>
          </View>
        ))}
      </Screen>
      <Fab
        label="Add expense"
        onPress={() =>
          router.push({ pathname: '/expense', params: filter === ALL ? {} : { categoryId: filter } })
        }
      />
    </ThemedView>
  );
}

/** One row of the list: an expense, or an income / refund. */
type Entry =
  | { day: string; expense: Expense; income?: undefined }
  | { day: string; income: Income; expense?: undefined };

/**
 * Expenses and income in one list, newest day first, grouped by day.
 * Both arrive sorted newest first; within a day, expenses come before income.
 */
function groupByDay(expenses: Expense[], incomes: Income[]): [string, Entry[]][] {
  const entries: Entry[] = [
    ...expenses.map((expense): Entry => ({ day: expense.spentOn, expense })),
    ...incomes.map((income): Entry => ({ day: income.receivedOn, income })),
  ];
  // Array.sort is stable, so each kind keeps its own order inside a day.
  entries.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const groups: [string, Entry[]][] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last[0] === entry.day) last[1].push(entry);
    else groups.push([entry.day, [entry]]);
  }
  return groups;
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
