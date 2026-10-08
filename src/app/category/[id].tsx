import { useSQLiteContext } from 'expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { splitLabel } from '@/components/split-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Button,
  Card,
  EmptyState,
  Fab,
  Field,
  Money,
  ProgressBar,
  Screen,
  SectionLabel,
  StatusPill,
  useStatusColor,
} from '@/components/ui';
import { listExpenses } from '@/db/repositories/expenses';
import { listIncomes } from '@/db/repositories/incomes';
import { setBudget } from '@/db/repositories/months';
import type { CategorySummary } from '@/domain/budget';
import { formatDay, formatMonth } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { useMonthSummary } from '@/hooks/use-month-summary';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';
import { usePeople } from '@/store/people';

/** One category in the selected month: how it is going, its budget, and its expenses. */
export default function CategoryDetailScreen() {
  const people = usePeople();
  const { id } = useLocalSearchParams<{ id: string }>();
  const month = useUiStore((s) => s.selectedMonth);
  const { data: view } = useMonthSummary(month);
  const { data: expenses } = useDbQuery((db) => listExpenses(db, month, id), [month, id]);
  const { data: refunds } = useDbQuery((db) => listIncomes(db, month, id), [month, id]);
  const theme = useTheme();

  const category = view?.summary.categories.find((c) => c.id === id);
  if (!view || !category) return null;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: category.name }} />
      <Screen tabs header>
        <ThemedText type="small" themeColor="textSecondary">
          {formatMonth(month)} · {category.isFixed ? 'Fixed cost' : 'Variable cost'}
        </ThemedText>

        <Overview category={category} />

        {view.month ? (
          <BudgetEditor
            key={`${month}-${category.budgetCents}`}
            month={month}
            categoryId={category.id}
            budgetCents={category.budgetCents}
          />
        ) : (
          <Button title="Plan this month first" variant="secondary" onPress={() => router.push('/plan')} />
        )}

        {refunds && refunds.length > 0 ? (
          <>
            <SectionLabel>Refunds</SectionLabel>
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {refunds.map((r, i) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push({ pathname: '/income', params: { id: r.id } })}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText>{formatDay(r.receivedOn)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      Refund{r.forWhom === 'shared' ? ' · shared' : r.forWhom === 'adriana' ? ` · for ${people.adriana}` : ''}
                      {r.note ? ` · ${r.note}` : ''}
                    </ThemedText>
                  </View>
                  <Money cents={-r.amountCents} color={theme.good} />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        <SectionLabel>Expenses</SectionLabel>
        {expenses && expenses.length === 0 ? (
          <EmptyState title="Nothing spent here yet" body="Tap + to add an expense to this category." />
        ) : null}
        {expenses && expenses.length > 0 ? (
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
                  <ThemedText>{formatDay(e.spentOn)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {splitLabel(e, people)}
                    {e.note ? ` · ${e.note}` : ''}
                  </ThemedText>
                </View>
                <Money cents={e.amountCents} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        <Button
          title="Edit category"
          variant="secondary"
          onPress={() => router.push({ pathname: '/category-edit', params: { id: category.id } })}
        />
      </Screen>
      <Fab
        label="Add expense"
        onPress={() => router.push({ pathname: '/expense', params: { categoryId: category.id } })}
      />
    </ThemedView>
  );
}

function Overview({ category: c }: { category: CategorySummary }) {
  const people = usePeople();
  const color = useStatusColor(c.status);
  const spent = Math.max(0, c.spentCents);
  const ratio = c.budgetCents > 0 ? spent / c.budgetCents : spent > 0 ? 1 : 0;
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.between}>
        <Money cents={Math.max(0, c.spentCents)} type="subtitle" />
        <StatusPill status={c.status} />
      </View>
      <ProgressBar ratio={ratio} color={color} />
      <View style={styles.between}>
        <Stat label="Budget" cents={c.budgetCents} />
        <Stat label={c.remainingCents < 0 ? 'Over by' : 'Left'} cents={Math.abs(c.remainingCents)} />
        <Stat label="Expected by month end" cents={c.projectedSpendCents} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Counts your share only: half of shared expenses, none of what was only for {people.adriana}.
        Refunds are taken off.
      </ThemedText>
      {c.pace !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {c.pace <= 1
            ? `Spending at ${Math.round(c.pace * 100)}% of an even pace.`
            : `Spending ${Math.round((c.pace - 1) * 100)}% faster than an even pace.`}
        </ThemedText>
      ) : null}
    </Card>
  );
}

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <View style={{ flexShrink: 1 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Money cents={cents} type="smallBold" />
    </View>
  );
}

function BudgetEditor({
  month,
  categoryId,
  budgetCents,
}: {
  month: string;
  categoryId: string;
  budgetCents: number;
}) {
  const db = useSQLiteContext();
  const [text, setText] = useState(centsToInputText(budgetCents));
  const parsed = parseAmountToCents(text);
  const changed = parsed !== null && parsed !== budgetCents;

  async function save() {
    if (parsed === null) return;
    try {
      await setBudget(db, month, categoryId, parsed);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Field
        label={`Budget for ${formatMonth(month)}`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
      />
      {changed ? <Button title="Save budget" onPress={save} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
