import { useSQLiteContext } from 'expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Field, Money, Screen, SectionLabel, Title } from '@/components/ui';
import { CURRENCY, PEOPLE } from '@/config';
import { setExchangeRate } from '@/db/repositories/accounts';
import type { Account, ExchangeRate } from '@/db/types';
import { formatDay, formatMonth, todayISO } from '@/domain/dates';
import { describeBalance } from '@/domain/split';
import { useOverview } from '@/hooks/use-overview';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/**
 * Everything you have and everything you expect to spend, in one place: accounts in any currency,
 * planned expenses counted as negative, and a total in the home currency.
 */
export default function AccountsScreen() {
  const theme = useTheme();
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const { data } = useOverview(selectedMonth);
  if (!data) return null;

  const { netWorth } = data;
  const withBalances = data.accounts;
  const accounts = withBalances.filter((a) => a.kind === 'account');
  const planned = withBalances.filter((a) => a.kind === 'planned');
  const foreign = netWorth.currencies.filter((c) => c.currency !== CURRENCY);
  const owed = describeBalance(data.owedCents);
  const monthName = formatMonth(selectedMonth);

  return (
    <Screen tabs>
      <Title>Accounts</Title>

      {withBalances.length === 0 ? (
        <EmptyState
          title="See all your money in one place"
          body="Add each account you have, in its own currency, and the expenses you are planning for."
        />
      ) : null}

      <Card style={{ gap: 12 }}>
        <View>
          <ThemedText type="small" themeColor="textSecondary">
            Total, after planned expenses and what is left to spend
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

      <SectionLabel>Accounts</SectionLabel>
      <AccountList
        accounts={accounts}
        hint={(a) =>
          a.linkedAccountId
            ? `Credit card · paid from ${accounts.find((b) => b.id === a.linkedAccountId)?.name ?? 'an account'}`
            : `${a.accountType === 'investment' ? 'Investment · ' : ''}Updated ${formatDay(a.balanceUpdatedOn)}`
        }
      />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ComputedRow
          name={owed ? `${PEOPLE[owed.debtor]} owes ${PEOPLE[owed.creditor]}` : `${PEOPLE.adriana} and ${PEOPLE.sergio}`}
          hint={owed ? 'From shared expenses, all months · tap to settle up' : 'All square'}
          cents={data.owedCents}
          onPress={() => router.push('/balance')}
        />
      </Card>
      <Button title="Add account" onPress={() => router.push('/account-edit')} />

      <SectionLabel>Planned expenses</SectionLabel>
      <ThemedText type="small" themeColor="textSecondary">
        Things you expect to pay for but have not put in a month yet. They count against the total.
      </ThemedText>
      <AccountList accounts={planned} negative hint={(a) => `Updated ${formatDay(a.balanceUpdatedOn)}`} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ComputedRow
          name={`Left to spend in ${monthName}`}
          hint={
            data.monthView.month
              ? 'Budget of the month you have not spent yet'
              : `${monthName} is not planned yet`
          }
          // `|| 0` avoids showing "-$0.00" for negative zero.
          cents={-data.leftToSpendCents || 0}
          onPress={() => router.navigate('/')}
        />
      </Card>
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
            cents={negative ? -a.balanceCents || 0 : a.balanceCents}
            currency={a.currency}
            color={negative || a.balanceCents < 0 ? theme.critical : undefined}
          />
          {/* A credit card can be paid straight from its row. */}
          {a.linkedAccountId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Pay ${a.name}`}
              hitSlop={8}
              onPress={() => router.push({ pathname: '/pay-card', params: { id: a.id } })}
              style={({ pressed }) => [styles.payButton, { backgroundColor: theme.tint, opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                Pay
              </ThemedText>
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </Card>
  );
}

/** A row the app works out by itself (it cannot be edited or deleted like an account). */
function ComputedRow({
  name,
  hint,
  cents,
  separator = false,
  onPress,
}: {
  name: string;
  hint: string;
  cents: number;
  separator?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        separator && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
        { opacity: pressed ? 0.6 : 1 },
      ]}>
      <View style={{ flex: 1 }}>
        <ThemedText>{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      <Money cents={cents} color={cents < 0 ? theme.critical : undefined} />
    </Pressable>
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
  payButton: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
