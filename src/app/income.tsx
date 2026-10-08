import { useSQLiteContext } from 'expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { ThemedText } from '@/components/themed-text';
import { Button, Chips, Field, Screen, SectionLabel } from '@/components/ui';
import { CURRENCY } from '@/config';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories, listCategoriesForMonth } from '@/db/repositories/categories';
import { addIncome, deleteIncome, getIncome, updateIncome } from '@/db/repositories/incomes';
import type { Account, Category, Income } from '@/db/types';
import { monthKeyOf, todayISO } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import type { ForWhom } from '@/domain/split';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { useUiStore } from '@/store/ui';
import { usePeople } from '@/store/people';

/** Add money you received (salary, a refund), or edit it when opened with ?id=. */
export default function IncomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data } = useDbQuery(
    async (db) => {
      const [income, accounts, categories] = await Promise.all([
        id ? getIncome(db, id) : null,
        listAccounts(db),
        listCategories(db, { includeArchived: true }),
      ]);
      return {
        income,
        categories,
        // The amount is in the home currency, so it can only be added to an account in it.
        // Credit cards are left out: income is not paid into a card.
        accounts: accounts.filter(
          (a) => a.kind === 'account' && a.currency === CURRENCY && a.linkedAccountId === null,
        ),
      };
    },
    [id],
  );
  if (!data) return null;
  return <IncomeForm {...data} />;
}

const NONE = 'none';

function IncomeForm({
  income,
  accounts,
  categories,
}: {
  income: Income | null;
  accounts: Account[];
  categories: Category[];
}) {
  const people = usePeople();
  const db = useSQLiteContext();
  const theme = useTheme();
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const today = todayISO();

  const [amountText, setAmountText] = useState(income ? centsToInputText(income.amountCents) : '');
  const [receivedOn, setReceivedOn] = useState(
    income?.receivedOn ?? (monthKeyOf(today) === selectedMonth ? today : `${selectedMonth}-01`),
  );
  const [note, setNote] = useState(income?.note ?? '');
  // A new income goes to the account marked "Default account for income", if there is one.
  const [accountId, setAccountId] = useState<string | null>(
    income ? income.accountId : (accounts.find((a) => a.isIncomeDefault)?.id ?? null),
  );
  const [categoryId, setCategoryId] = useState<string | null>(income?.categoryId ?? null);
  const [forWhom, setForWhom] = useState<ForWhom>(income?.forWhom ?? 'sergio');
  const [saving, setSaving] = useState(false);

  // A refund can be for any category in the plan of its month, plus the one already chosen.
  const month = monthKeyOf(receivedOn);
  const { data: monthCategories } = useDbQuery((db) => listCategoriesForMonth(db, month), [month]);
  const categoryOptions = (monthCategories ?? []).map((c) => ({ value: c.id, label: c.name }));
  const chosen = categories.find((c) => c.id === categoryId);
  if (chosen && !categoryOptions.some((o) => o.value === chosen.id)) {
    categoryOptions.push({ value: chosen.id, label: chosen.name });
  }

  const amountCents = parseAmountToCents(amountText);
  const canSave = amountCents !== null && amountCents > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const input = { amountCents, receivedOn, note, accountId, categoryId, forWhom };
    try {
      if (income) await updateIncome(db, income.id, input);
      else await addIncome(db, input);
      router.back();
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  function confirmDelete() {
    if (!income) return;
    confirmDestructive('Delete this income?', 'Delete', async () => {
      await deleteIncome(db, income.id);
      router.back();
    });
  }

  return (
    <Screen>
      <Field
        label="Amount received"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus={!income}
        style={styles.amount}
      />
      {amountText !== '' && amountCents === null ? (
        <ThemedText type="small" style={{ color: theme.critical }}>
          Enter an amount like 2500.00
        </ThemedText>
      ) : null}

      <SectionLabel>Goes into account</SectionLabel>
      {accounts.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Add an account in {CURRENCY} on the Accounts tab to have income added to its balance.
        </ThemedText>
      ) : (
        <>
          <Chips
            options={[
              ...accounts.map((a) => ({ value: a.id, label: a.name })),
              { value: NONE, label: 'No account' },
            ]}
            value={accountId ?? NONE}
            onChange={(value) => setAccountId(value === NONE ? null : value)}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {accountId
              ? 'The amount is added to that account\'s balance. Do not add it by hand as well.'
              : 'No balance is changed.'}
          </ThemedText>
        </>
      )}

      <SectionLabel>Is it a refund for a category?</SectionLabel>
      <Chips
        options={[{ value: NONE, label: 'No, it is income' }, ...categoryOptions]}
        value={categoryId ?? NONE}
        onChange={(value) => setCategoryId(value === NONE ? null : value)}
      />
      {categoryId ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            A refund lowers what you spent in {chosen?.name ?? 'that category'} and is not counted as
            income.
          </ThemedText>
          <SectionLabel>The refund is for</SectionLabel>
          <Chips
            options={[
              { value: 'sergio', label: `Only ${people.sergio}` },
              { value: 'shared', label: 'Shared 50/50' },
              { value: 'adriana', label: `Only ${people.adriana}` },
            ]}
            value={forWhom}
            onChange={setForWhom}
          />
        </>
      ) : null}

      <SectionLabel>Date</SectionLabel>
      <DateField value={receivedOn} onChange={setReceivedOn} />

      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Salary" />

      <View style={{ gap: 8, marginTop: 8 }}>
        <Button title={income ? 'Save changes' : categoryId ? 'Add refund' : 'Add income'} onPress={save} disabled={!canSave} />
        {income ? <Button title="Delete income" variant="destructive" onPress={confirmDelete} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 34, fontWeight: 600, paddingVertical: 16 },
});
