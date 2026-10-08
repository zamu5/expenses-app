import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Money, Screen, SectionLabel } from '@/components/ui';
import { CURRENCY } from '@/config';
import { toHomeCents } from '@/domain/accounts';
import { formatMonth } from '@/domain/dates';
import { useOverview } from '@/hooks/use-overview';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/** How "Started with" on the Month tab is worked out, line by line, with today's numbers. */
export default function StartedWithScreen() {
  const theme = useTheme();
  const month = useUiStore((s) => s.selectedMonth);
  const { data } = useOverview(month);
  if (!data) return null;

  const rateOf = Object.fromEntries(data.rates.map((r) => [r.currency, r.unitsPerHome]));
  const inHome = (cents: number, currency: string) =>
    currency === CURRENCY ? cents : rateOf[currency] ? toHomeCents(cents, rateOf[currency]) : null;

  const included = data.accounts.filter((a) => a.kind === 'account' && a.includeInStart);
  const left = data.accounts.filter((a) => a.kind === 'account' && !a.includeInStart);
  const planned = data.accounts.filter((a) => a.kind === 'planned');

  const line = (key: string, label: string, hint: string | null, cents: number | null, sign: 1 | -1 = 1) => (
    <View key={key} style={styles.row}>
      <View style={{ flex: 1 }}>
        <ThemedText>{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {cents === null ? (
        <ThemedText type="small" style={{ color: theme.warning }}>
          no rate, not counted
        </ThemedText>
      ) : (
        <Money cents={sign * cents || 0} color={sign * cents < 0 ? theme.critical : undefined} />
      )}
    </View>
  );

  // Shows the original amount next to a converted one, e.g. "COP 5,900,000 at 2950".
  const converted = (cents: number, currency: string) =>
    currency === CURRENCY
      ? null
      : `${new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)}${rateOf[currency] ? ` at ${rateOf[currency]}` : ''}`;

  return (
    <Screen>
      <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatMonth(month)} started with
        </ThemedText>
        <Money cents={data.startedWithCents} type="subtitle" />
      </Card>

      <ThemedText type="small" themeColor="textSecondary">
        Accounts counted in the starting balance, minus planned expenses, with this month's own
        income and payments taken back out so they are not counted twice.
      </ThemedText>

      <SectionLabel>Accounts counted (balance today)</SectionLabel>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {included.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ paddingVertical: 10 }}>
            No account has "Include in starting balance" switched on.
          </ThemedText>
        ) : null}
        {included.map((a) =>
          line(
            a.id,
            a.name,
            a.linkedAccountId ? 'Credit card' : converted(a.balanceCents, a.currency),
            inHome(a.balanceCents, a.currency),
          ),
        )}
      </Card>

      <SectionLabel>Minus planned expenses</SectionLabel>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {planned.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ paddingVertical: 10 }}>
            None.
          </ThemedText>
        ) : null}
        {planned.map((a) => line(a.id, a.name, converted(a.balanceCents, a.currency), inHome(a.balanceCents, a.currency), -1))}
      </Card>

      <SectionLabel>Undoing this month</SectionLabel>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {line(
          'deposits',
          'Minus income and refunds paid into those accounts',
          'Already inside the balances above',
          data.depositedThisMonthCents,
          -1,
        )}
        {line(
          'payments',
          'Plus expenses paid from those accounts and cards',
          'Already taken out of the balances above',
          data.paidThisMonthCents,
        )}
      </Card>

      <Card>
        <View style={styles.row}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            Started with
          </ThemedText>
          <Money cents={data.startedWithCents} type="smallBold" />
        </View>
      </Card>

      {left.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Not counted, because "Include in starting balance" is off: {left.map((a) => a.name).join(', ')}.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
