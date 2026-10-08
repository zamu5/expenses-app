import { useSQLiteContext } from 'expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Field, Screen, SectionLabel } from '@/components/ui';
import { PEOPLE } from '@/config';
import { listCategories, listCategoriesForMonth } from '@/db/repositories/categories';
import { addExpense, deleteExpense, getExpense, updateExpense } from '@/db/repositories/expenses';
import type { Category, Expense } from '@/db/types';
import { formatDay, monthKeyOf, shiftDay, todayISO } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import type { ForWhom, Person } from '@/domain/split';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/** Add a new expense, or edit one when opened with ?id=. */
export default function ExpenseScreen() {
  const { id, categoryId } = useLocalSearchParams<{ id?: string; categoryId?: string }>();
  const { data } = useDbQuery(
    async (db) => ({
      categories: await listCategories(db, { includeArchived: true }),
      expense: id ? await getExpense(db, id) : null,
    }),
    [id],
  );

  if (!data) return null;
  // Render the form only once the data is loaded, so its initial state can come straight from it.
  return (
    <ExpenseForm
      categories={data.categories}
      expense={data.expense}
      initialCategoryId={categoryId}
    />
  );
}

function ExpenseForm({
  categories,
  expense,
  initialCategoryId,
}: {
  categories: Category[];
  expense: Expense | null;
  initialCategoryId?: string;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const lastPaidBy = useUiStore((s) => s.lastPaidBy);
  const setLastPaidBy = useUiStore((s) => s.setLastPaidBy);
  const today = todayISO();

  const [amountText, setAmountText] = useState(expense ? centsToInputText(expense.amountCents) : '');
  const [categoryId, setCategoryId] = useState<string | null>(
    expense?.categoryId ?? initialCategoryId ?? null,
  );
  // New expenses default to today, or to the 1st when you are looking at another month.
  const [spentOn, setSpentOn] = useState(
    expense?.spentOn ?? (monthKeyOf(today) === selectedMonth ? today : `${selectedMonth}-01`),
  );
  const [note, setNote] = useState(expense?.note ?? '');
  const [paidBy, setPaidBy] = useState<Person>(expense?.paidBy ?? lastPaidBy);
  const [forWhom, setForWhom] = useState<ForWhom>(expense?.forWhom ?? 'shared');
  const [saving, setSaving] = useState(false);

  const amountCents = parseAmountToCents(amountText);
  const canSave = amountCents !== null && amountCents > 0 && categoryId !== null && !saving;

  // The picker offers the categories in the plan of the month the expense falls in,
  // plus the one already selected (it may be archived, or not part of that month).
  const expenseMonth = monthKeyOf(spentOn);
  const { data: monthCategories } = useDbQuery(
    (db) => listCategoriesForMonth(db, expenseMonth),
    [expenseMonth],
  );
  const options = (monthCategories ?? []).map((c) => ({ value: c.id, label: c.name }));
  const selected = categories.find((c) => c.id === categoryId);
  if (selected && !options.some((o) => o.value === selected.id)) {
    options.push({ value: selected.id, label: selected.name });
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const input = { categoryId, amountCents, spentOn, note, paidBy, forWhom };
    try {
      if (expense) await updateExpense(db, expense.id, input);
      else await addExpense(db, input);
      setLastPaidBy(paidBy);
      router.back();
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  function confirmDelete() {
    if (!expense) return;
    Alert.alert('Delete this expense?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(db, expense.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Field
        label="Amount"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus={!expense}
        style={styles.amount}
      />
      {amountText !== '' && amountCents === null ? (
        <ThemedText type="small" style={{ color: theme.critical }}>
          Enter an amount like 12.50
        </ThemedText>
      ) : null}

      <SectionLabel>Category</SectionLabel>
      <Chips options={options} value={categoryId} onChange={setCategoryId} />

      <SectionLabel>Paid by</SectionLabel>
      <Chips
        options={[
          { value: 'sergio', label: PEOPLE.sergio },
          { value: 'adriana', label: PEOPLE.adriana },
        ]}
        value={paidBy}
        onChange={setPaidBy}
      />

      <SectionLabel>For</SectionLabel>
      <Chips
        options={[
          { value: 'shared', label: 'Shared 50/50' },
          { value: 'sergio', label: `Only ${PEOPLE.sergio}` },
          { value: 'adriana', label: `Only ${PEOPLE.adriana}` },
        ]}
        value={forWhom}
        onChange={setForWhom}
      />

      <SectionLabel>Date</SectionLabel>
      <Card style={styles.dateRow}>
        <Pressable hitSlop={12} onPress={() => setSpentOn(shiftDay(spentOn, -1))}>
          <ThemedText style={[styles.arrow, { color: theme.tint }]}>‹</ThemedText>
        </Pressable>
        <Pressable onPress={() => setSpentOn(today)} style={{ alignItems: 'center' }}>
          <ThemedText>{spentOn === today ? 'Today' : formatDay(spentOn)}</ThemedText>
          {spentOn !== today ? (
            <ThemedText type="small" style={{ color: theme.tint }}>
              Set to today
            </ThemedText>
          ) : null}
        </Pressable>
        <Pressable hitSlop={12} onPress={() => setSpentOn(shiftDay(spentOn, 1))}>
          <ThemedText style={[styles.arrow, { color: theme.tint }]}>›</ThemedText>
        </Pressable>
      </Card>

      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="What was it?" />

      <View style={{ gap: 8, marginTop: 8 }}>
        <Button title={expense ? 'Save changes' : 'Add expense'} onPress={save} disabled={!canSave} />
        {expense ? <Button title="Delete expense" variant="destructive" onPress={confirmDelete} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 34, fontWeight: 600, paddingVertical: 16 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { fontSize: 30, lineHeight: 34, paddingHorizontal: 8 },
});
