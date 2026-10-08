import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { balanceSentence } from '@/components/split-label';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, EmptyState, Field, Money, Screen, SectionLabel } from '@/components/ui';
import { PEOPLE } from '@/config';
import { addSettlement, deleteSettlement, listSettlements } from '@/db/repositories/settlements';
import { formatDay, todayISO } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { otherPerson, type Person, type SplitTotals } from '@/domain/split';
import { useBalance } from '@/hooks/use-balance';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';

/** Who owes whom across every month, where that number comes from, and paying it back. */
export default function BalanceScreen() {
  const theme = useTheme();
  const db = useSQLiteContext();
  const { data } = useBalance();
  const { data: settlements } = useDbQuery(listSettlements, []);

  if (!data) return null;
  const { balance, totals } = data;

  return (
    <Screen>
      <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
        <ThemedText type="small" themeColor="textSecondary">
          {balanceSentence(balance)}
        </ThemedText>
        <Money cents={balance?.amountCents ?? 0} type="subtitle" />
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Running total of every month. Shared expenses are split 50/50.
        </ThemedText>
      </Card>

      <SectionLabel>Where it comes from</SectionLabel>
      <Card>
        <Breakdown totals={totals} person="sergio" />
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator }} />
        <Breakdown totals={totals} person="adriana" />
      </Card>

      {/* The key resets the form to the new amount owed after each payment. */}
      <SettleUp
        key={`${balance?.debtor}-${balance?.amountCents}`}
        debtor={balance?.debtor ?? 'adriana'}
        owedCents={balance?.amountCents ?? 0}
      />

      <SectionLabel>Payments</SectionLabel>
      {settlements && settlements.length === 0 ? (
        <EmptyState title="No payments yet" body="Record one when either of you pays the other back." />
      ) : null}
      {settlements && settlements.length > 0 ? (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {settlements.map((s, i) => (
            <View
              key={s.id}
              style={[
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
              ]}>
              <View style={{ flex: 1 }}>
                <ThemedText>
                  {PEOPLE[s.fromPerson]} paid {PEOPLE[s.toPerson]}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDay(s.settledOn)}
                </ThemedText>
              </View>
              <Money cents={s.amountCents} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove payment"
                hitSlop={12}
                onPress={() => deleteSettlement(db, s.id)}>
                <ThemedText style={{ color: theme.critical, fontSize: 20 }}>×</ThemedText>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function Breakdown({ totals, person }: { totals: SplitTotals; person: Person }) {
  const other = PEOPLE[otherPerson(person)];
  const line = (label: string, cents: number) => (
    <View style={styles.between}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Money cents={cents} type="small" />
    </View>
  );
  return (
    <View style={{ gap: 4 }}>
      <ThemedText type="smallBold">{PEOPLE[person]} paid</ThemedText>
      {line('Shared expenses', totals.sharedPaidBy[person])}
      {line(`Expenses only for ${other}`, totals.paidForOtherBy[person])}
      {line(`Paid back to ${other}`, totals.settledBy[person])}
    </View>
  );
}

function SettleUp({ debtor, owedCents }: { debtor: Person; owedCents: number }) {
  const db = useSQLiteContext();
  const [fromPerson, setFromPerson] = useState<Person>(debtor);
  const [text, setText] = useState(owedCents > 0 ? centsToInputText(owedCents) : '');
  const amountCents = parseAmountToCents(text);
  const canSave = amountCents !== null && amountCents > 0;

  async function save() {
    if (!canSave) return;
    try {
      await addSettlement(db, { fromPerson, amountCents, settledOn: todayISO() });
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>Settle up</SectionLabel>
      <Chips
        options={(['sergio', 'adriana'] as const).map((p) => ({
          value: p,
          label: `${PEOPLE[p]} pays ${PEOPLE[otherPerson(p)]}`,
        }))}
        value={fromPerson}
        onChange={setFromPerson}
      />
      <Field label="Amount" value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="0.00" />
      <Button title="Record payment" onPress={save} disabled={!canSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
