import { useSQLiteContext } from 'expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

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
import { setBudget } from '@/db/repositories/months';
import type { CategorySummary } from '@/domain/budget';
import { formatDay, formatMonth } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { useMonthSummary } from '@/hooks/use-month-summary';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/** One category in the selected month: how it is going, its budget, and its expenses. */
export default function CategoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const month = useUiStore((s) => s.selectedMonth);
  const { data: view } = useMonthSummary(month);
  const { data: expenses } = useDbQuery((db) => listExpenses(db, month, id), [month, id]);
  const theme = useTheme();

  const category = view?.summary.categories.find((c) => c.id === id);
  if (!view || !category) return null;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: category.name }} />
      <Screen tabs>
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
                  {e.note ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {e.note}
                    </ThemedText>
                  ) : null}
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
  const color = useStatusColor(c.status);
  const ratio = c.budgetCents > 0 ? c.spentCents / c.budgetCents : c.spentCents > 0 ? 1 : 0;
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.between}>
        <Money cents={c.spentCents} type="subtitle" />
        <StatusPill status={c.status} />
      </View>
      <ProgressBar ratio={ratio} color={color} />
      <View style={styles.between}>
        <Stat label="Budget" cents={c.budgetCents} />
        <Stat label={c.remainingCents < 0 ? 'Over by' : 'Left'} cents={Math.abs(c.remainingCents)} />
        <Stat label="Expected by month end" cents={c.projectedSpendCents} />
      </View>
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
