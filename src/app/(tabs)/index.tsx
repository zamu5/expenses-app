import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { IncomeList } from '@/components/income-list';
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
import { listIncomes } from '@/db/repositories/incomes';
import { CURRENCY } from '@/config';
import { explainMonthStatus, type CategorySummary } from '@/domain/budget';
import { formatMonth } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { useOverview } from '@/hooks/use-overview';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

export default function MonthScreen() {
  const selectedMonth = useUiStore((s) => s.selectedMonth);
  const { data: overview, error } = useOverview(selectedMonth);
  const data = overview?.monthView;
  // Four tiles per row: the screen width, minus the page padding and the three gaps between them.
  const { width: screenWidth } = useWindowDimensions();
  const contentWidth = screenWidth - Spacing.three * 2;
  const tileWidth = Math.floor((contentWidth - TILE_GAP * (TILES_PER_ROW - 1)) / TILES_PER_ROW);
  const { data: incomes } = useDbQuery((db) => listIncomes(db, selectedMonth), [selectedMonth]);

  return (
    <ThemedView style={{ flex: 1 }}>
      <Screen tabs>
        <Title>Month</Title>
        <MonthSwitcher />

        {error ? <ThemedText>Could not load this month: {error.message}</ThemedText> : null}

        {data && !data.month ? (
          <>
            <EmptyState
              title={`Plan ${formatMonth(selectedMonth)}`}
              body="Set a budget for each category. What you start with comes from your accounts."
            />
            <Button title="Plan this month" onPress={() => router.push('/plan')} />
          </>
        ) : null}

        {data?.month ? (
          <>
            <BalanceCard
              startingCents={overview?.startedWith.totalHomeCents ?? 0}
              incomeCents={data.summary.totalIncomeCents}
              currentCents={overview?.netWorth.totalHomeCents ?? 0}
              missingRates={overview?.netWorth.missingRates ?? []}
              plannedCents={data.summary.plannedEndCents}
              status={data.summary.status}
              statusReason={explainMonthStatus(data.summary, (cents) => formatCents(cents, CURRENCY))}
              daysElapsed={data.daysElapsed}
              daysInMonth={data.daysInMonth}
            />

            <IncomeList incomes={incomes ?? []} />

            <SectionLabel>Categories</SectionLabel>
            <View style={[styles.grid, { gap: TILE_GAP }]}>
              {data.summary.categories.map((c) => (
                <CategoryTile key={c.id} category={c} width={tileWidth} />
              ))}
            </View>

            <Button title="Edit plan" variant="secondary" onPress={() => router.push('/plan')} />
          </>
        ) : null}

        <Button title="Backup and restore" variant="secondary" onPress={() => router.push('/settings')} />
      </Screen>
      <Fab label="Add expense" onPress={() => router.push('/expense')} />
    </ThemedView>
  );
}

function BalanceCard(props: {
  /** Accounts marked "include in starting balance", minus planned expenses. */
  startingCents: number;
  incomeCents: number;
  /** The Accounts tab total: every account, what is owed, minus planned expenses and what is left to spend. */
  currentCents: number;
  missingRates: string[];
  /** Money in the account you pay from: start + income - what you paid, with payments between you two. */
  plannedCents: number;
  status: 'onTrack' | 'watch' | 'danger';
  /** Shown as a legend while the pointer is over the status (or a finger is held on it). */
  statusReason: string;
  daysElapsed: number;
  daysInMonth: number;
}) {
  const theme = useTheme();
  const [legendOpen, setLegendOpen] = useState(false);
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
        <Pressable
          accessibilityHint={props.statusReason}
          onHoverIn={() => setLegendOpen(true)}
          onHoverOut={() => setLegendOpen(false)}
          onPressIn={() => setLegendOpen(true)}
          onPressOut={() => setLegendOpen(false)}>
          <StatusPill status={props.status} />
        </Pressable>
        {legendOpen ? (
          <View
            pointerEvents="none"
            style={[styles.legend, { backgroundColor: theme.backgroundSelected, borderColor: theme.separator }]}>
            <ThemedText type="small">{props.statusReason}</ThemedText>
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => router.navigate('/accounts')}>
        <ThemedText type="small" themeColor="textSecondary">
          Current balance
        </ThemedText>
        <Money
          cents={props.currentCents}
          type="subtitle"
          color={props.currentCents < 0 ? theme.critical : undefined}
        />
        <ThemedText type="small" themeColor="textSecondary">
          All accounts, minus planned expenses and what is left to spend
          {props.missingRates.length > 0 ? `. Not counted: ${props.missingRates.join(', ')} (no rate)` : ''}
        </ThemedText>
      </Pressable>
      <View style={styles.between}>
        <Stat label="Started with" cents={props.startingCents} onPress={() => router.navigate('/accounts')} />
        <Stat label="Planned end" cents={props.plannedCents} />
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

const TILES_PER_ROW = 4;
const TILE_GAP = Spacing.two;

/** An amount with its cents but without the currency symbol ("1,200.00"), to fit a small tile. */
const formatPlain = (cents: number) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(cents) / 100,
  );

/** One category as a small box: what is left of its budget, what was spent of how much, and a bar. */
function CategoryTile({ category: c, width }: { category: CategorySummary; width: number }) {
  const theme = useTheme();
  const color = useStatusColor(c.status);
  const ratio = c.budgetCents > 0 ? c.spentCents / c.budgetCents : c.spentCents > 0 ? 1 : 0;
  const isOver = c.remainingCents < 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${c.name}: ${formatPlain(c.remainingCents)} ${isOver ? 'over' : 'left'}, ${formatPlain(c.spentCents)} spent of ${formatPlain(c.budgetCents)}`}
      onPress={() => router.push({ pathname: '/category/[id]', params: { id: c.id } })}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
      ]}>
      <ThemedText type="small" numberOfLines={2} style={styles.tileName}>
        {c.name}
      </ThemedText>
      <View>
        <ThemedText
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.tileAmount, { color: isOver ? theme.critical : theme.text }]}>
          {formatPlain(c.remainingCents)}
        </ThemedText>
        {/* The word carries the meaning too, so it does not depend on the colour alone. */}
        <ThemedText type="small" style={[styles.tileCaption, { color: isOver ? theme.critical : theme.textSecondary }]}>
          {isOver ? 'over' : 'left'}
        </ThemedText>
      </View>
      <View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} adjustsFontSizeToFit style={styles.tileCaption}>
          {formatPlain(c.spentCents)} spent
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} adjustsFontSizeToFit style={styles.tileCaption}>
          of {formatPlain(c.budgetCents)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.tileCaption}>
          {Math.round(ratio * 100)}%{c.isFixed ? ' · fixed' : ''}
        </ThemedText>
      </View>
      <ProgressBar ratio={ratio} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Floats under the status label, over the rest of the card.
  legend: {
    position: 'absolute',
    top: 30,
    right: 0,
    zIndex: 1,
    maxWidth: 260,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { borderRadius: 12, padding: 6, justifyContent: 'space-between', gap: Spacing.one },
  // Two lines are always reserved, so tiles in a row line up whatever the name length.
  tileName: { fontSize: 12, lineHeight: 15, fontWeight: 600, minHeight: 30 },
  tileAmount: { fontSize: 14, lineHeight: 18, fontWeight: 700, fontVariant: ['tabular-nums'] },
  tileCaption: { fontSize: 10, lineHeight: 13, fontVariant: ['tabular-nums'] },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  incomeRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
});
