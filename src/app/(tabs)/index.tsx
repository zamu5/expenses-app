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
  SettingsFab,
  StatusPill,
  Title,
  useStatusColor,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { listIncomes } from '@/db/repositories/incomes';
import { CURRENCY } from '@/config';
import {
  explainMonthStatus,
  isPaidInFull,
  sortPaidLast,
  type CategorySummary,
} from '@/domain/budget';
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
  // Two tiles per row on a phone, three on anything wider. The tile width is the screen width
  // minus the page padding and the gaps between tiles.
  const { width: screenWidth } = useWindowDimensions();
  const contentWidth = screenWidth - Spacing.three * 2;
  const isPhone = screenWidth < PHONE_MAX_WIDTH;
  const tilesPerRow = isPhone ? 2 : 3;
  const tileWidth = Math.floor((contentWidth - TILE_GAP * (tilesPerRow - 1)) / tilesPerRow);
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
              body="Set what you start the month with and a budget for each category."
            />
            <Button title="Plan this month" onPress={() => router.push('/plan')} />
          </>
        ) : null}

        {data?.month ? (
          <>
            <BalanceCard
              startingCents={data.month.startingBalanceCents}
              incomeCents={data.summary.totalIncomeCents}
              currentCents={overview?.netWorth.totalHomeCents ?? 0}
              missingRates={overview?.netWorth.missingRates ?? []}
              plannedCents={data.summary.plannedEndCents}
              status={data.summary.status}
              statusReason={explainMonthStatus(data.summary, (cents) => formatCents(cents, CURRENCY))}
              daysElapsed={data.daysElapsed}
              daysInMonth={data.daysInMonth}
            />

            <IncomeList
              incomes={incomes ?? []}
              categoryNames={new Map(data.summary.categories.map((c) => [c.id, c.name]))}
            />

            <SectionLabel>Categories</SectionLabel>
            <View style={[styles.grid, { gap: TILE_GAP }]}>
              {sortPaidLast(data.summary.categories).map((c) => (
                <CategoryTile key={c.id} category={c} width={tileWidth} compact={isPhone} />
              ))}
            </View>

            <Button title="Edit plan" variant="secondary" onPress={() => router.push('/plan')} />
          </>
        ) : null}
      </Screen>
      <SettingsFab />
      <Fab label="Add expense" onPress={() => router.push('/expense')} />
    </ThemedView>
  );
}

function BalanceCard(props: {
  /** Saved with the month's plan: typed for the first month, the current balance after that. */
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
        <Stat label="Started with" cents={props.startingCents} onPress={() => router.push('/plan')} />
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

/** Below this window width the layout is a phone's: two tiles per row, and the short "x spent". */
const PHONE_MAX_WIDTH = 600;
const TILE_GAP = Spacing.two;

/** An amount with its cents but without the currency symbol ("1,200.00"), to fit a small tile. */
const formatPlain = (cents: number) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(cents) / 100,
  );

/**
 * One category as a small box. First line: its name, and on the right what is left of its
 * budget. Then what was spent of how much, and a bar.
 */
function CategoryTile({
  category: c,
  width,
  compact,
}: {
  category: CategorySummary;
  width: number;
  /** On a phone the spending line is just "x spent", without the budget. */
  compact: boolean;
}) {
  const theme = useTheme();
  const color = useStatusColor(c.status);
  // A refund bigger than the month's spending makes "spent" negative; show that as nothing spent.
  const spentCents = Math.max(0, c.spentCents);
  const ratio = c.budgetCents > 0 ? spentCents / c.budgetCents : spentCents > 0 ? 1 : 0;
  const isOver = c.remainingCents < 0;
  // A fixed cost paid exactly: done for the month, so it is dimmed and says so.
  const isDone = isPaidInFull(c) && !isOver;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${c.name}: ${isDone ? 'paid, ' : ''}${formatPlain(c.remainingCents)} ${isOver ? 'over' : 'left'}, ${formatPlain(spentCents)} spent of ${formatPlain(c.budgetCents)}`}
      onPress={() => router.push({ pathname: '/category/[id]', params: { id: c.id } })}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : isDone ? 0.55 : 1 },
      ]}>
      {/* Name on the left, what is left on the right, on the same line. */}
      <View style={styles.tileHeader}>
        <ThemedText
          type="small"
          numberOfLines={2}
          style={styles.tileName}>
          {c.name}
        </ThemedText>
        <View style={styles.tileTopRight}>
          <ThemedText
            numberOfLines={1}
            style={[styles.tileAmount, { color: isOver ? theme.critical : theme.text }]}>
            {isDone ? '✓ Paid' : formatPlain(c.remainingCents)}
          </ThemedText>
          {/* The word carries the meaning too, so it does not depend on the colour alone. */}
          <ThemedText type="small" style={[styles.tileCaption, { color: isOver ? theme.critical : theme.textSecondary }]}>
            {isDone ? 'done' : isOver ? 'over' : 'left'}
          </ThemedText>
        </View>
      </View>
      <View>
        {/* "x spent of y" on one line, the percentage on the right. A phone only has room for "x spent". */}
        <View style={styles.tileSpentRow}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={[styles.tileCaption, styles.tileSpent]}>
            {formatPlain(spentCents)} spent
            {compact ? '' : ` of ${formatPlain(c.budgetCents)}`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.tileCaption}>
            {Math.round(ratio * 100)}%
          </ThemedText>
        </View>
        {/* Always takes its line, so fixed and other tiles are the same height. */}
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={[styles.tileCaption, { textAlign: 'right' }]}>
          {c.isFixed ? 'fixed' : ' '}
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
  tile: { borderRadius: 12, padding: 10, justifyContent: 'space-between', gap: Spacing.two },
  // Two lines are always reserved, so tiles in a row line up whatever the name length.
  // Room for a two-line name, so tiles in a row line up whatever the name length.
  tileHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, minHeight: 38 },
  // Takes whatever width the amount leaves, wrapping onto more lines.
  // No shrink-to-fit here: on iOS it sized some names tiny on the first layout. Long names wrap.
  tileName: { flex: 1, flexShrink: 1, minWidth: 0, fontSize: 16, lineHeight: 19, fontWeight: 700 },
  // Never shrinks: the amount is always whole, and the name gets what is left.
  tileTopRight: { alignItems: 'flex-end', flexShrink: 0 },
  tileAmount: { fontSize: 16, lineHeight: 19, fontWeight: 700, fontVariant: ['tabular-nums'] },
  tileSpentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  // Gives way to the percentage when the box is narrow.
  tileSpent: { flexShrink: 1, minWidth: 0 },
  tileCaption: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  incomeRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
});
