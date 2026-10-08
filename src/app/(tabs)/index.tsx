import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { BalanceBetweenCard } from '@/components/balance-between-card';
import { MonthSwitcher } from '@/components/month-switcher';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Button,
  Card,
  EmptyState,
  Fab,
  Money,
  ProgressBar,
  Screen,
  SectionLabel,
  StatusPill,
  Title,
  useStatusColor,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { CategorySummary } from '@/domain/budget';
import { formatMonth } from '@/domain/dates';
import { useMonthSummary } from '@/hooks/use-month-summary';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

export default function MonthScreen() {
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const { data, error } = useMonthSummary(selectedMonth);

  return (
    <ThemedView style={{ flex: 1 }}>
      <Screen tabs>
        <Title>Month</Title>
        <MonthSwitcher />

        {error ? <ThemedText>Could not load this month: {error.message}</ThemedText> : null}

        <BalanceBetweenCard />

        {data && !data.month ? (
          <>
            <EmptyState
              title={`Plan ${formatMonth(selectedMonth)}`}
              body="Set the money you start the month with and a budget for each category."
            />
            <Button title="Plan this month" onPress={() => router.push('/plan')} />
          </>
        ) : null}

        {data?.month ? (
          <>
            <BalanceCard
              startingCents={data.month.startingBalanceCents}
              incomeCents={data.summary.totalIncomeCents}
              currentCents={data.summary.currentBalanceCents}
              plannedCents={data.summary.plannedEndCents}
              projectedCents={data.summary.projectedEndCents}
              status={data.summary.status}
              isEarly={data.summary.isEarlyEstimate}
              daysElapsed={data.daysElapsed}
              daysInMonth={data.daysInMonth}
            />

            <SectionLabel>Categories</SectionLabel>
            {data.summary.categories.map((c) => (
              <CategoryRow key={c.id} category={c} />
            ))}

            <Button title="Edit plan" variant="secondary" onPress={() => router.push('/plan')} />
          </>
        ) : null}
      </Screen>
      <Fab label="Add expense" onPress={() => router.push('/expense')} />
    </ThemedView>
  );
}

function BalanceCard(props: {
  startingCents: number;
  incomeCents: number;
  currentCents: number;
  plannedCents: number;
  projectedCents: number;
  status: 'onTrack' | 'watch' | 'danger';
  isEarly: boolean;
  daysElapsed: number;
  daysInMonth: number;
}) {
  const theme = useTheme();
  const statusColor = useStatusColor(props.status);
  const dayLabel =
    props.daysElapsed === 0
      ? 'Not started yet'
      : props.daysElapsed >= props.daysInMonth
        ? 'Month closed'
        : `Day ${props.daysElapsed} of ${props.daysInMonth}`;

  return (
    <Card style={{ gap: Spacing.three }}>
      <View style={styles.between}>
        <ThemedText type="small" themeColor="textSecondary">
          {dayLabel}
        </ThemedText>
        <StatusPill status={props.status} />
      </View>
      <View>
        <ThemedText type="small" themeColor="textSecondary">
          Current balance
        </ThemedText>
        <Money cents={props.currentCents} type="subtitle" />
      </View>
      <View style={styles.between}>
        <Stat label="Started with" cents={props.startingCents} onPress={() => router.push('/plan')} />
        <Stat label="Planned end" cents={props.plannedCents} />
        <Stat
          label={props.isEarly ? 'Projected (early)' : 'Projected end'}
          cents={props.projectedCents}
          color={statusColor}
        />
      </View>
      <View style={[styles.between, styles.incomeRow, { borderTopColor: theme.separator }]}>
        <Stat label="Income this month" cents={props.incomeCents} color={theme.good} />
        <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.push('/income')}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            + Add income
          </ThemedText>
        </Pressable>
      </View>
    </Card>
  );
}

function Stat({
  label,
  cents,
  color,
  onPress,
}: {
  label: string;
  cents: number;
  color?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexShrink: 1 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Money cents={cents} type="smallBold" color={color} />
    </Pressable>
  );
}

function CategoryRow({ category: c }: { category: CategorySummary }) {
  const theme = useTheme();
  const color = useStatusColor(c.status);
  const ratio = c.budgetCents > 0 ? c.spentCents / c.budgetCents : c.spentCents > 0 ? 1 : 0;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/category/[id]', params: { id: c.id } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card>
        <View style={styles.between}>
          <ThemedText type="smallBold" style={{ fontSize: 16 }}>
            {c.name}
            {c.isFixed ? (
              <ThemedText type="small" themeColor="textSecondary">
                {'  fixed'}
              </ThemedText>
            ) : null}
          </ThemedText>
          <StatusPill status={c.status} />
        </View>
        <ProgressBar ratio={ratio} color={color} />
        <View style={styles.between}>
          <ThemedText type="small" themeColor="textSecondary">
            <Money cents={c.spentCents} type="small" color={theme.textSecondary} /> of{' '}
            <Money cents={c.budgetCents} type="small" color={theme.textSecondary} />
          </ThemedText>
          <ThemedText type="small" style={{ color: c.remainingCents < 0 ? theme.critical : theme.text }}>
            <Money
              cents={Math.abs(c.remainingCents)}
              type="small"
              color={c.remainingCents < 0 ? theme.critical : theme.text}
            />
            {c.remainingCents < 0 ? ' over' : ' left'}
          </ThemedText>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  incomeRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
});
