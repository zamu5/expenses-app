import { useSQLiteContext } from 'expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Field, Money, Screen, SectionLabel, ToggleRow } from '@/components/ui';
import { PEOPLE } from '@/config';
import { createCategory, listCategories, listCategoriesForMonth } from '@/db/repositories/categories';
import { getBudgets, getMonth, getPreviousPlan, saveMonthPlan } from '@/db/repositories/months';
import type { Category } from '@/db/types';
import { formatMonth, type MonthKey } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { loadOverview } from '@/hooks/use-overview';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/**
 * One budget per category for the selected month, and what the month starts with: typed for
 * the very first month, the current balance for every month after it.
 * A month that was never planned is pre-filled from the most recent planned month.
 * Categories can be added to or removed from this month only, which is how categories
 * that are not monthly (insurance, holidays) come and go.
 */
export default function PlanScreen() {
  const month = useUiStore((s) => s.selectedMonth);
  const { data } = useDbQuery(
    async (db) => {
      const [existing, categories, inMonth, previous, overview] = await Promise.all([
        getMonth(db, month),
        listCategories(db),
        listCategoriesForMonth(db, month),
        getPreviousPlan(db, month),
        loadOverview(db, month),
      ]);
      const start = {
        // Only the very first month is typed; later months start from the current balance.
        isFirstMonth: previous === null,
        savedCents: existing ? existing.startingBalanceCents : null,
        currentBalanceCents: overview.startingBalance.totalHomeCents,
        missingRates: overview.startingBalance.missingRates,
      };
      const inMonthIds = inMonth.map((c) => c.id);
      if (existing) {
        return {
          categories,
          inMonthIds,
          start,
          budgets: await getBudgets(db, month),
          expectedIncomeCents: existing.expectedIncomeCents,
          copiedFrom: null,
        };
      }
      return {
        categories,
        inMonthIds,
        start,
        budgets: previous?.budgets ?? {},
        expectedIncomeCents: previous?.month.expectedIncomeCents ?? 0,
        copiedFrom: previous?.month.monthKey ?? null,
      };
    },
    [month],
  );

  if (!data) return null;
  return <PlanForm month={month} {...data} />;
}

interface StartInfo {
  isFirstMonth: boolean;
  /** The amount already saved for this month, or null when it is not planned yet. */
  savedCents: number | null;
  /** Accounts, plus or minus what is owed between the two people, minus planned expenses. */
  currentBalanceCents: number;
  missingRates: string[];
}

function PlanForm({
  month,
  categories,
  inMonthIds,
  start,
  budgets,
  expectedIncomeCents,
  copiedFrom,
}: {
  month: MonthKey;
  /** Every active category; `inMonthIds` are the ones in this month's plan when the form opened. */
  categories: Category[];
  inMonthIds: string[];
  /** Where the month's starting amount comes from (see StartSection). */
  start: StartInfo;
  budgets: Record<string, number>;
  expectedIncomeCents: number;
  copiedFrom: MonthKey | null;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  // First month: typed. Later months: the saved amount, or the current balance when chosen.
  const [startText, setStartText] = useState(
    start.isFirstMonth && start.savedCents !== null ? centsToInputText(start.savedCents) : '',
  );
  const [useCurrentBalance, setUseCurrentBalance] = useState(start.savedCents === null);
  const typedStart = startText.trim() === '' ? 0 : parseAmountToCents(startText);
  const startCents = start.isFirstMonth
    ? typedStart
    : useCurrentBalance || start.savedCents === null
      ? start.currentBalanceCents
      : start.savedCents;
  const [incomeText, setIncomeText] = useState(
    expectedIncomeCents > 0 ? centsToInputText(expectedIncomeCents) : '',
  );
  const [budgetTexts, setBudgetTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      categories.map((c) => [c.id, budgets[c.id] ? centsToInputText(budgets[c.id]) : '']),
    ),
  );

  const [includedIds, setIncludedIds] = useState(inMonthIds);
  // A category made in "Manage categories" while this form is open arrives as a new id in
  // `inMonthIds`. Put it in the plan once, without undoing removals made here.
  const [seenIds, setSeenIds] = useState(inMonthIds);
  const arrived = inMonthIds.filter((id) => !seenIds.includes(id));
  if (arrived.length > 0) {
    setSeenIds([...seenIds, ...arrived]);
    setIncludedIds((prev) => [...prev, ...arrived.filter((id) => !prev.includes(id))]);
  }
  const [newName, setNewName] = useState('');
  const [newIsMonthly, setNewIsMonthly] = useState(false);

  const included = categories.filter((c) => includedIds.includes(c.id));
  const available = categories.filter((c) => !includedIds.includes(c.id));
  const budgetText = (id: string) => budgetTexts[id] ?? '';

  // An empty budget field means 0.
  const parsedBudgets = included.map((c) => ({
    categoryId: c.id,
    amountCents: budgetText(c.id).trim() === '' ? 0 : parseAmountToCents(budgetText(c.id)),
  }));
  // An empty salary field means none is expected.
  const expectedIncome = incomeText.trim() === '' ? 0 : parseAmountToCents(incomeText);
  const invalid =
    startCents === null || expectedIncome === null || parsedBudgets.some((b) => b.amountCents === null);
  const totalBudget = parsedBudgets.reduce((sum, b) => sum + (b.amountCents ?? 0), 0);

  async function save() {
    if (invalid) return;
    try {
      await saveMonthPlan(db, {
        month,
        startingBalanceCents: startCents,
        expectedIncomeCents: expectedIncome,
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

      {start.isFirstMonth ? (
        <>
          <Field
            label="What you start this month with"
            value={startText}
            onChangeText={setStartText}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          {typedStart === null ? (
            <ThemedText type="small" style={{ color: theme.critical }}>
              Enter an amount like 1500.00
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Typed by hand for your first month. From the next month on, the app uses your current
              balance.
            </ThemedText>
          )}
        </>
      ) : (
        <Card style={{ gap: 8 }}>
          <ThemedText type="small" themeColor="textSecondary">
            {start.savedCents === null || useCurrentBalance
              ? `You will start ${formatMonth(month)} with your current balance`
              : `You started ${formatMonth(month)} with`}
          </ThemedText>
          <Money cents={startCents ?? 0} type="subtitle" />
          {start.missingRates.length > 0 ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              Not counted: {start.missingRates.join(', ')} (no exchange rate).
            </ThemedText>
          ) : null}
          {start.savedCents !== null && !useCurrentBalance && start.currentBalanceCents !== start.savedCents ? (
            <Button
              title={`Use current balance instead (${centsToInputText(start.currentBalanceCents)})`}
              variant="secondary"
              onPress={() => setUseCurrentBalance(true)}
            />
          ) : null}
          <Button title="Edit accounts" variant="secondary" onPress={() => router.dismissTo('/accounts')} />
          <ThemedText type="small" themeColor="textSecondary">
            This is all your accounts, plus or minus what you and {PEOPLE.adriana} owe each other,
            minus planned expenses. If it looks wrong, an account balance is off: fix it in Accounts.
          </ThemedText>
        </Card>
      )}

      <Field
        label="Expected salary this month"
        value={incomeText}
        onChangeText={setIncomeText}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      {expectedIncome === null ? (
        <ThemedText type="small" style={{ color: theme.critical }}>
          Enter an amount like 2500.00
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          What you expect to receive. It counts in the planned end until you log the real income.
        </ThemedText>
      )}

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
        {expectedIncome ? (
          <>
            <View style={styles.total}>
              <ThemedText type="small" themeColor="textSecondary">
                Expected salary
              </ThemedText>
              <Money cents={expectedIncome} type="smallBold" />
            </View>
            <View style={styles.total}>
              <ThemedText type="small" themeColor="textSecondary">
                {expectedIncome - totalBudget < 0 ? 'Budgeted over the salary' : 'Salary left unassigned'}
              </ThemedText>
              <Money
                cents={Math.abs(expectedIncome - totalBudget)}
                type="smallBold"
                color={expectedIncome - totalBudget < 0 ? theme.critical : theme.good}
              />
            </View>
          </>
        ) : null}
      </Card>

      <Button title="Save plan" onPress={save} disabled={invalid} />
      <Button title="Manage categories" variant="secondary" onPress={() => router.push('/categories')} />
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Rename or archive a category, or change whether it is fixed or in every month.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  budgetInput: { width: 120, textAlign: 'right', paddingVertical: 8 },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
