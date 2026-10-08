import { useSQLiteContext } from 'expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Field, Money, Screen, SectionLabel, Title } from '@/components/ui';
import { CURRENCY } from '@/config';
import { listAccounts, listExchangeRates, setExchangeRate } from '@/db/repositories/accounts';
import type { Account, ExchangeRate } from '@/db/types';
import { computeNetWorth } from '@/domain/accounts';
import { formatDay, formatMonth, todayISO } from '@/domain/dates';
import { useDbQuery } from '@/hooks/use-db-query';
import { loadMonthView } from '@/hooks/use-month-summary';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/**
 * Everything you have and everything you expect to spend, in one place: accounts in any currency,
 * planned expenses counted as negative, and a total in the home currency.
 */
export default function AccountsScreen() {
  const theme = useTheme();
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const { data } = useDbQuery(
    async (db) => {
      const [accounts, rates, monthView] = await Promise.all([
        listAccounts(db),
        listExchangeRates(db),
        loadMonthView(db, selectedMonth),
      ]);
      return { accounts, rates, monthView };
    },
    [selectedMonth],
  );
  if (!data) return null;

  // The budget account's balance is not typed: it is the selected month's current balance.
  const budgetCents = data.monthView.month ? data.monthView.summary.currentBalanceCents : 0;
  const withBalances = data.accounts.map((a) => (a.isBudgetAccount ? { ...a, balanceCents: budgetCents } : a));

  const accounts = withBalances.filter((a) => a.kind === 'account');
  const planned = withBalances.filter((a) => a.kind === 'planned');
  const rateOf = Object.fromEntries(data.rates.map((r) => [r.currency, r.unitsPerHome]));
  const netWorth = computeNetWorth(withBalances, rateOf, CURRENCY);
  const foreign = netWorth.currencies.filter((c) => c.currency !== CURRENCY);

  return (
    <Screen tabs>
      <Title>Accounts</Title>

      {withBalances.length === 0 ? (
        <EmptyState
          title="See all your money in one place"
          body="Add each account you have, in its own currency, and the expenses you are planning for."
        />
      ) : (
        <Card style={{ gap: 12 }}>
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              Total, after planned expenses
            </ThemedText>
            <Money
              cents={netWorth.totalHomeCents}
              type="subtitle"
              color={netWorth.totalHomeCents < 0 ? theme.critical : undefined}
            />
          </View>
          {netWorth.currencies.map((c) => (
            <View key={c.currency} style={styles.between}>
              <ThemedText type="small" themeColor="textSecondary">
                {c.currency}
              </ThemedText>
              <View style={{ alignItems: 'flex-end' }}>
                <Money cents={c.netCents} type="smallBold" currency={c.currency} />
                {c.currency === CURRENCY ? null : c.netHomeCents === null ? (
                  <ThemedText type="small" style={{ color: theme.warning }}>
                    Not in the total: set its rate below
                  </ThemedText>
                ) : (
                  <Money cents={c.netHomeCents} type="small" color={theme.textSecondary} />
                )}
              </View>
            </View>
          ))}
        </Card>
      )}

      <SectionLabel>Accounts</SectionLabel>
      <AccountList
        accounts={accounts}
        hint={(a) =>
          a.isBudgetAccount
            ? data.monthView.month
              ? `Budget account · ${formatMonth(selectedMonth)} balance`
              : `Budget account · ${formatMonth(selectedMonth)} is not planned yet`
            : `Updated ${formatDay(a.balanceUpdatedOn)}`
        }
      />
      <Button title="Add account" onPress={() => router.push('/account-edit')} />

      <SectionLabel>Planned expenses</SectionLabel>
      <ThemedText type="small" themeColor="textSecondary">
        Things you expect to pay for but have not put in a month yet. They count against the total.
      </ThemedText>
      <AccountList accounts={planned} negative hint={(a) => `Updated ${formatDay(a.balanceUpdatedOn)}`} />
      <Button
        title="Add planned expense"
        variant="secondary"
        onPress={() => router.push({ pathname: '/account-edit', params: { kind: 'planned' } })}
      />

      {foreign.length > 0 ? (
        <>
          <SectionLabel>Exchange rates</SectionLabel>
          {foreign.map((c) => {
            const rate = data.rates.find((r) => r.currency === c.currency);
            // The key resets the field when the saved rate changes.
            return <RateEditor key={`${c.currency}-${rate?.unitsPerHome}`} currency={c.currency} rate={rate} />;
          })}
        </>
      ) : null}
    </Screen>
  );
}

function AccountList({
  accounts,
  hint,
  negative = false,
}: {
  accounts: Account[];
  hint: (account: Account) => string;
  negative?: boolean;
}) {
  const theme = useTheme();
  if (accounts.length === 0) return null;
  return (
    <Card style={{ gap: 0, paddingVertical: 4 }}>
      {accounts.map((a, i) => (
        <Pressable
          key={a.id}
          onPress={() => router.push({ pathname: '/account-edit', params: { id: a.id } })}
          style={({ pressed }) => [
            styles.row,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
            { opacity: pressed ? 0.6 : 1 },
          ]}>
          <View style={{ flex: 1 }}>
            <ThemedText>{a.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {hint(a)}
            </ThemedText>
          </View>
          <Money
            cents={negative ? -a.balanceCents : a.balanceCents}
            currency={a.currency}
            color={negative || a.balanceCents < 0 ? theme.critical : undefined}
          />
        </Pressable>
      ))}
    </Card>
  );
}

/** "1 CAD = [2950] COP", typed by hand. */
function RateEditor({ currency, rate }: { currency: string; rate?: ExchangeRate }) {
  const db = useSQLiteContext();
  const [text, setText] = useState(rate ? String(rate.unitsPerHome) : '');
  const parsed = Number(text.trim().replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
  const changed = valid && parsed !== rate?.unitsPerHome;

  async function save() {
    if (!valid) return;
    try {
      await setExchangeRate(db, { currency, unitsPerHome: parsed, setOn: todayISO() });
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Field
        label={`1 ${CURRENCY} = how many ${currency}?`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        placeholder="0"
      />
      <ThemedText type="small" themeColor="textSecondary">
        {rate ? `Rate set on ${formatDay(rate.setOn)}. Update it whenever you like.` : 'No rate yet.'}
      </ThemedText>
      {changed ? <Button title={`Save ${currency} rate`} onPress={save} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
