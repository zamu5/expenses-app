import { useSQLiteContext } from 'expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { ThemedText } from '@/components/themed-text';
import { Button, Field, Screen, SectionLabel } from '@/components/ui';
import { addIncome, deleteIncome, getIncome, updateIncome } from '@/db/repositories/incomes';
import type { Income } from '@/db/types';
import { monthKeyOf, todayISO } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { useUiStore } from '@/store/ui';

/** Add money you received (salary, a refund), or edit it when opened with ?id=. */
export default function IncomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data } = useDbQuery(async (db) => ({ income: id ? await getIncome(db, id) : null }), [id]);
  if (!data) return null;
  return <IncomeForm income={data.income} />;
}

function IncomeForm({ income }: { income: Income | null }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const today = todayISO();

  const [amountText, setAmountText] = useState(income ? centsToInputText(income.amountCents) : '');
  const [receivedOn, setReceivedOn] = useState(
    income?.receivedOn ?? (monthKeyOf(today) === selectedMonth ? today : `${selectedMonth}-01`),
  );
  const [note, setNote] = useState(income?.note ?? '');
  const [saving, setSaving] = useState(false);

  const amountCents = parseAmountToCents(amountText);
  const canSave = amountCents !== null && amountCents > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const input = { amountCents, receivedOn, note };
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
      <ThemedText type="small" themeColor="textSecondary">
        Income is added to the balance of the month it was received in.
      </ThemedText>

      <SectionLabel>Date</SectionLabel>
      <DateField value={receivedOn} onChange={setReceivedOn} />

      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Salary" />

      <View style={{ gap: 8, marginTop: 8 }}>
        <Button title={income ? 'Save changes' : 'Add income'} onPress={save} disabled={!canSave} />
        {income ? <Button title="Delete income" variant="destructive" onPress={confirmDelete} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 34, fontWeight: 600, paddingVertical: 16 },
});
