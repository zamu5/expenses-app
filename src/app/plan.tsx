import { useSQLiteContext } from 'expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Field, Money, Screen, SectionLabel, ToggleRow } from '@/components/ui';
import { createCategory, listCategories, listCategoriesForMonth } from '@/db/repositories/categories';
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
 * Categories can be added to or removed from this month only, which is how categories
 * that are not monthly (insurance, holidays) come and go.
 */
export default function PlanScreen() {
  const month = useUiStore((s) => s.selectedMonth);
  const { data } = useDbQuery(
    async (db) => {
      const [existing, categories, inMonth] = await Promise.all([
        getMonth(db, month),
        listCategories(db),
        listCategoriesForMonth(db, month),
      ]);
      const inMonthIds = inMonth.map((c) => c.id);
      if (existing) {
        return {
          categories,
          inMonthIds,
          startingCents: existing.startingBalanceCents,
          budgets: await getBudgets(db, month),
          copiedFrom: null,
        };
      }
      const previous = await getPreviousPlan(db, month);
      return {
        categories,
        inMonthIds,
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
  inMonthIds,
  startingCents,
  budgets,
  copiedFrom,
}: {
  month: MonthKey;
  /** Every active category; `inMonthIds` are the ones in this month's plan when the form opened. */
  categories: Category[];
  inMonthIds: string[];
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

  const [includedIds, setIncludedIds] = useState(inMonthIds);
  const [newName, setNewName] = useState('');
  const [newIsMonthly, setNewIsMonthly] = useState(false);

  const included = categories.filter((c) => includedIds.includes(c.id));
  const available = categories.filter((c) => !includedIds.includes(c.id));
  const budgetText = (id: string) => budgetTexts[id] ?? '';

  const starting = parseAmountToCents(startingText);
  // An empty budget field means 0.
  const parsedBudgets = included.map((c) => ({
    categoryId: c.id,
    amountCents: budgetText(c.id).trim() === '' ? 0 : parseAmountToCents(budgetText(c.id)),
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
        // Only categories that would otherwise be in this month need to be recorded as removed.
        removedCategoryIds: available
          .filter((c) => c.isMonthly || inMonthIds.includes(c.id))
          .map((c) => c.id),
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  async function addNewCategory() {
    if (newName.trim() === '') return;
    try {
      const id = await createCategory(db, { name: newName, isFixed: false, isMonthly: newIsMonthly });
      setIncludedIds((prev) => [...prev, id]);
      setNewName('');
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : String(e));
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
        {included.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ paddingVertical: 12 }}>
            No categories in this month yet. Add one below.
          </ThemedText>
        ) : null}
        {included.map((c, i) => (
          <View
            key={c.id}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
            ]}>
            <ThemedText style={{ flex: 1 }}>{c.name}</ThemedText>
            <Field
              label=""
              value={budgetText(c.id)}
              onChangeText={(text) => setBudgetTexts((prev) => ({ ...prev, [c.id]: text }))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              style={styles.budgetInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${c.name} from this month`}
              hitSlop={12}
              onPress={() => setIncludedIds((prev) => prev.filter((id) => id !== c.id))}>
              <ThemedText style={{ color: theme.critical, fontSize: 22 }}>×</ThemedText>
            </Pressable>
          </View>
        ))}
      </Card>
      <ThemedText type="small" themeColor="textSecondary">
        × takes a category out of {formatMonth(month)} only. It stays in your other months.
      </ThemedText>

      <SectionLabel>Add a category to this month</SectionLabel>
      {available.length > 0 ? (
        <Chips
          options={available.map((c) => ({ value: c.id, label: `+ ${c.name}` }))}
          value={null}
          onChange={(id) => setIncludedIds((prev) => [...prev, id])}
        />
      ) : null}
      <Field label="New category" value={newName} onChangeText={setNewName} placeholder="Car insurance" />
      {newName.trim() !== '' ? (
        <>
          <ToggleRow
            label="Every month"
            hint="Off: it is only in this month, until you add it to another one."
            value={newIsMonthly}
            onValueChange={setNewIsMonthly}
          />
          <Button title={`Add ${newName.trim()}`} variant="secondary" onPress={addNewCategory} />
        </>
      ) : null}

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
