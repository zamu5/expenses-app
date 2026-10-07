import { useSQLiteContext } from 'expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field, Money, Screen, SectionLabel } from '@/components/ui';
import { listCategories } from '@/db/repositories/categories';
import { getBudgets, getMonth, getPreviousPlan, saveMonthPlan } from '@/db/repositories/months';
import type { Category } from '@/db/types';
import { formatMonth, type MonthKey } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/**
 * Starting balance + one budget per category for the selected month.
 * A month that was never planned is pre-filled from the most recent planned month.
 */
export default function PlanScreen() {
  const month = useUiStore((s) => s.selectedMonth);
  const { data } = useDbQuery(
    async (db) => {
      const [existing, categories] = await Promise.all([getMonth(db, month), listCategories(db)]);
      if (existing) {
        return { categories, startingCents: existing.startingBalanceCents, budgets: await getBudgets(db, month), copiedFrom: null };
      }
      const previous = await getPreviousPlan(db, month);
      return {
        categories,
        startingCents: null,
        budgets: previous?.budgets ?? {},
        copiedFrom: previous?.month.monthKey ?? null,
      };
    },
    [month],
  );

  if (!data) return null;
  return <PlanForm month={month} {...data} />;
}

function PlanForm({
  month,
  categories,
  startingCents,
  budgets,
  copiedFrom,
}: {
  month: MonthKey;
  categories: Category[];
  startingCents: number | null;
  budgets: Record<string, number>;
  copiedFrom: MonthKey | null;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [startingText, setStartingText] = useState(
    startingCents === null ? '' : centsToInputText(startingCents),
  );
  const [budgetTexts, setBudgetTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      categories.map((c) => [c.id, budgets[c.id] ? centsToInputText(budgets[c.id]) : '']),
    ),
  );

  const starting = parseAmountToCents(startingText);
  // An empty budget field means 0.
  const parsedBudgets = categories.map((c) => ({
    categoryId: c.id,
    amountCents: budgetTexts[c.id].trim() === '' ? 0 : parseAmountToCents(budgetTexts[c.id]),
  }));
  const invalid = starting === null || parsedBudgets.some((b) => b.amountCents === null);
  const totalBudget = parsedBudgets.reduce((sum, b) => sum + (b.amountCents ?? 0), 0);

  async function save() {
    if (invalid) return;
    try {
      await saveMonthPlan(db, {
        month,
        startingBalanceCents: starting,
        budgets: parsedBudgets.map((b) => ({ categoryId: b.categoryId, amountCents: b.amountCents ?? 0 })),
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen>
      <ThemedText type="smallBold" style={{ fontSize: 22 }}>
        {formatMonth(month)}
      </ThemedText>
      {copiedFrom ? (
        <ThemedText type="small" themeColor="textSecondary">
          Budgets copied from {formatMonth(copiedFrom)}. Adjust anything that changed.
        </ThemedText>
      ) : null}

      <Field
        label="Money at the start of the month"
        value={startingText}
        onChangeText={setStartingText}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus={startingCents === null}
      />

      <SectionLabel>Budget per category</SectionLabel>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {categories.map((c, i) => (
          <View
            key={c.id}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
            ]}>
            <ThemedText style={{ flex: 1 }}>{c.name}</ThemedText>
            <Field
              label=""
              value={budgetTexts[c.id]}
              onChangeText={(text) => setBudgetTexts((prev) => ({ ...prev, [c.id]: text }))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              style={styles.budgetInput}
            />
          </View>
        ))}
      </Card>

      <Card>
        <View style={styles.total}>
          <ThemedText type="small" themeColor="textSecondary">
            Total budgeted
          </ThemedText>
          <Money cents={totalBudget} type="smallBold" />
        </View>
        {starting !== null ? (
          <View style={styles.total}>
            <ThemedText type="small" themeColor="textSecondary">
              Left at the end if you stick to it
            </ThemedText>
            <Money
              cents={starting - totalBudget}
              type="smallBold"
              color={starting - totalBudget < 0 ? theme.critical : theme.good}
            />
          </View>
        ) : null}
      </Card>

      <Button title="Save plan" onPress={save} disabled={invalid} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  budgetInput: { width: 120, textAlign: 'right', paddingVertical: 8 },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
