import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BalanceBetweenCard } from '@/components/balance-between-card';
import { IncomeList } from '@/components/income-list';
import { MonthSwitcher } from '@/components/month-switcher';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { splitLabel } from '@/components/split-label';
import { Card, Chips, EmptyState, Fab, Money, Screen, SectionLabel, Title } from '@/components/ui';
import { PEOPLE } from '@/config';
import { listCategories } from '@/db/repositories/categories';
import { listExpenses } from '@/db/repositories/expenses';
import { listIncomes } from '@/db/repositories/incomes';
import type { Expense } from '@/db/types';
import { formatDay } from '@/domain/dates';
import { matchesSplitFilter, type SplitFilter } from '@/domain/split';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

const ALL = 'all';

export default function ExpensesScreen() {
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
    splitFilter.paidBy === 'all' ? null : `Paid by ${PEOPLE[splitFilter.paidBy]}`,
    splitFilter.forWhom === 'all'
      ? null
      : splitFilter.forWhom === 'shared'
        ? 'Shared'
        : `Only ${PEOPLE[splitFilter.forWhom]}`,
  ].filter((label): label is string => label !== null);
  // The category filter is applied by the query; who paid / shared is applied here.
  const expenses = (data?.expenses ?? []).filter((e) => matchesSplitFilter(e, splitFilter));
  const days = groupByDay(expenses);
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
                { value: 'sergio', label: PEOPLE.sergio },
                { value: 'adriana', label: PEOPLE.adriana },
              ]}
              value={splitFilter.paidBy}
              onChange={(paidBy) => setSplitFilter({ paidBy })}
            />
            <SectionLabel>For</SectionLabel>
            <Chips<SplitFilter['forWhom']>
              options={[
                { value: 'all', label: 'All' },
                { value: 'shared', label: 'Shared' },
                { value: 'sergio', label: `Only ${PEOPLE.sergio}` },
                { value: 'adriana', label: `Only ${PEOPLE.adriana}` },
              ]}
              value={splitFilter.forWhom}
              onChange={(forWhom) => setSplitFilter({ forWhom })}
            />
          </>
        ) : null}

        {/* Income has no category or payer, so it only shows when no filter is on. */}
        {data && filter === ALL && !isSplitFiltered ? <IncomeList incomes={data.incomes} categoryNames={categoryName} /> : null}

        {data && expenses.length === 0 ? (
          data.expenses.length === 0 ? (
            <EmptyState title="No expenses yet" body="Tap + to log what you spend." />
          ) : (
            <EmptyState title="Nothing matches" body="No expenses for this filter in this month." />
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

        {days.map(([day, expenses]) => (
          <View key={day} style={{ gap: 6 }}>
            <View style={styles.between}>
              <SectionLabel>{formatDay(day)}</SectionLabel>
              <Money
                cents={expenses.reduce((sum, e) => sum + e.amountCents, 0)}
                type="small"
                color={theme.textSecondary}
              />
            </View>
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {expenses.map((e, i) => (
                <Pressable
                  key={e.id}
                  onPress={() => router.push({ pathname: '/expense', params: { id: e.id } })}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText>{categoryName.get(e.categoryId) ?? 'Unknown'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {splitLabel(e)}
                      {e.note ? ` · ${e.note}` : ''}
                    </ThemedText>
                  </View>
                  <Money cents={e.amountCents} />
                </Pressable>
              ))}
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

/** Expenses arrive sorted newest first, so consecutive rows of the same day form a group. */
function groupByDay(expenses: Expense[]): [string, Expense[]][] {
  const groups: [string, Expense[]][] = [];
  for (const e of expenses) {
    const last = groups.at(-1);
    if (last && last[0] === e.spentOn) last[1].push(e);
    else groups.push([e.spentOn, [e]]);
  }
  return groups;
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
