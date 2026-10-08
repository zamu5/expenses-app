import { useSQLiteContext } from 'expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { ThemedText } from '@/components/themed-text';
import { Button, Chips, Field, Screen, SectionLabel } from '@/components/ui';
import { CURRENCY, PEOPLE } from '@/config';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories, listCategoriesForMonth } from '@/db/repositories/categories';
import {
  addExpense,
  deleteExpense,
  getExpense,
  saveExpenseWithPart,
  updateExpense,
} from '@/db/repositories/expenses';
import type { Account, Category, Expense } from '@/db/types';
import { monthKeyOf, todayISO } from '@/domain/dates';
import { centsToInputText, parseAmountToCents, splitOffPart } from '@/domain/money';
import { BUDGET_OWNER, type ForWhom, type Person } from '@/domain/split';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { useUiStore } from '@/store/ui';

const NO_METHOD = 'none';

const FOR_WHOM_OPTIONS: { value: ForWhom; label: string }[] = [
  { value: 'shared', label: 'Shared 50/50' },
  { value: 'sergio', label: `Only ${PEOPLE.sergio}` },
  { value: 'adriana', label: `Only ${PEOPLE.adriana}` },
];

/** Add a new expense, or edit one when opened with ?id=. */
export default function ExpenseScreen() {
  const { id, categoryId } = useLocalSearchParams<{ id?: string; categoryId?: string }>();
  const { data } = useDbQuery(
    async (db) => ({
      categories: await listCategories(db, { includeArchived: true }),
      expense: id ? await getExpense(db, id) : null,
      // What an expense can be paid with: bank accounts and credit cards in the home currency.
      methods: (await listAccounts(db)).filter(
        (a) => a.kind === 'account' && a.accountType === 'bank' && a.currency === CURRENCY,
      ),
    }),
    [id],
  );

  if (!data) return null;
  // Render the form only once the data is loaded, so its initial state can come straight from it.
  return (
    <ExpenseForm
      categories={data.categories}
      expense={data.expense}
      methods={data.methods}
      initialCategoryId={categoryId}
    />
  );
}

function ExpenseForm({
  categories,
  expense,
  methods,
  initialCategoryId,
}: {
  categories: Category[];
  expense: Expense | null;
  methods: Account[];
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
  // A new expense starts on the default payment method, if one is set.
  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(
    expense ? expense.paymentAccountId : (methods.find((m) => m.isPaymentDefault)?.id ?? null),
  );
  const [saving, setSaving] = useState(false);
  // Part of this purchase that belongs to another category (clothes on a groceries receipt).
  const [partOpen, setPartOpen] = useState(false);
  const [partText, setPartText] = useState('');
  const [partCategoryId, setPartCategoryId] = useState<string | null>(null);
  // Who the part was for. Null means the same as the rest of the purchase.
  const [partForWhom, setPartForWhom] = useState<ForWhom | null>(null);

  const amountCents = parseAmountToCents(amountText);
  const partCents = parseAmountToCents(partText);
  const part =
    partOpen && amountCents !== null && partCents !== null ? splitOffPart(amountCents, partCents) : null;
  // With the split open, both its amount and its category must be valid before saving.
  const partReady = !partOpen || (part !== null && partCategoryId !== null && partCategoryId !== categoryId);
  const canSave =
    amountCents !== null && amountCents > 0 && categoryId !== null && partReady && !saving;

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
    const input = {
      categoryId,
      amountCents,
      spentOn,
      note,
      paidBy,
      forWhom,
      // Only the owner's own accounts and cards are tracked.
      paymentAccountId: paidBy === BUDGET_OWNER ? paymentAccountId : null,
    };
    try {
      if (part && partCategoryId) {
        await saveExpenseWithPart(db, expense?.id ?? null, input, {
          categoryId: partCategoryId,
          amountCents: part.partCents,
          forWhom: partForWhom ?? forWhom,
        });
      } else if (expense) await updateExpense(db, expense.id, input);
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
    confirmDestructive('Delete this expense?', 'Delete', async () => {
      await deleteExpense(db, expense.id);
      router.back();
    });
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

      {partOpen ? (
        <View style={{ gap: 8 }}>
          <Field
            label="How much of it goes to another category"
            value={partText}
            onChangeText={setPartText}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <Chips
            options={options.filter((o) => o.value !== categoryId)}
            value={partCategoryId}
            onChange={setPartCategoryId}
          />
          <SectionLabel>That part is for</SectionLabel>
          <Chips
            options={FOR_WHOM_OPTIONS}
            value={partForWhom ?? forWhom}
            onChange={setPartForWhom}
          />
          {part ? (
            <ThemedText type="small" themeColor="textSecondary">
              {selected?.name ?? 'First category'} {centsToInputText(part.restCents)}
              {' · '}
              {categories.find((c) => c.id === partCategoryId)?.name ?? 'other category'}{' '}
              {centsToInputText(part.partCents)}
              {(partForWhom ?? forWhom) !== forWhom
                ? ` (${FOR_WHOM_OPTIONS.find((o) => o.value === partForWhom)?.label})`
                : ''}
            </ThemedText>
          ) : partText !== '' ? (
            <ThemedText type="small" style={{ color: theme.critical }}>
              Enter an amount smaller than the total.
            </ThemedText>
          ) : null}
          <Button
            title="Do not split"
            variant="secondary"
            onPress={() => {
              setPartOpen(false);
              setPartText('');
              setPartCategoryId(null);
              setPartForWhom(null);
            }}
          />
        </View>
      ) : (
        <Button title="Split with another category" variant="secondary" onPress={() => setPartOpen(true)} />
      )}

      <SectionLabel>Paid by</SectionLabel>
      <Chips
        options={[
          { value: 'sergio', label: PEOPLE.sergio },
          { value: 'adriana', label: PEOPLE.adriana },
        ]}
        value={paidBy}
        onChange={setPaidBy}
      />

      {paidBy === BUDGET_OWNER && methods.length > 0 ? (
        <>
          <SectionLabel>Paid with</SectionLabel>
          <Chips
            options={[
              ...methods.map((m) => ({ value: m.id, label: m.linkedAccountId ? `${m.name} (card)` : m.name })),
              { value: NO_METHOD, label: 'Not tracked' },
            ]}
            value={paymentAccountId ?? NO_METHOD}
            onChange={(value) => setPaymentAccountId(value === NO_METHOD ? null : value)}
          />
        </>
      ) : null}

      <SectionLabel>For</SectionLabel>
      <Chips
        options={FOR_WHOM_OPTIONS}
        value={forWhom}
        onChange={setForWhom}
      />

      <SectionLabel>Date</SectionLabel>
      <DateField value={spentOn} onChange={setSpentOn} />

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
});
