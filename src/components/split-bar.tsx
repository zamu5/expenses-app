import { useRef } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CURRENCY } from '@/config';
import type { PeopleNames } from '@/db/repositories/settings';
import { formatCents } from '@/domain/money';
import { DEFAULT_OWNER_SHARE_PCT } from '@/domain/split';
import { useTheme } from '@/hooks/use-theme';

const STEP = 5;
const HEIGHT = 48;
/** A side with a smaller share than this has no room for its label. */
const MIN_LABEL_PCT = 25;
const HANDLE_WIDTH = 18;
const TICKS = [0, 25, 50, 75, 100];

const snap = (pct: number) => Math.min(100, Math.max(0, Math.round(pct / STEP) * STEP));

/**
 * How a shared amount is divided, as one bar in two colours: the first person's share on the
 * left, the other person's on the right. Drag the divider, or tap anywhere on the bar, to move
 * it in steps of 5%. Shown on the expense and refund forms only while "For" is shared.
 */
export function SplitBar({
  value,
  onChange,
  people,
  ownerCents,
  otherCents,
}: {
  /** The first person's share, 0-100. */
  value: number;
  onChange: (pct: number) => void;
  people: PeopleNames;
  /** What each side comes to for the amount on the form. Left out until an amount is typed. */
  ownerCents?: number;
  otherCents?: number;
}) {
  const theme = useTheme();
  const bar = useRef<View>(null);
  // Where the bar is on screen, measured when a touch starts, so a drag can be turned into a share.
  const frame = useRef({ x: 0, width: 0 });

  const moveTo = (pageX: number) => {
    const { x, width: w } = frame.current;
    if (w > 0) onChange(snap(((pageX - x) / w) * 100));
  };
  const start = (e: GestureResponderEvent) => {
    const pageX = e.nativeEvent.pageX;
    bar.current?.measureInWindow((x, _y, w) => {
      frame.current = { x, width: w };
      moveTo(pageX);
    });
  };

  const label = (name: string, pct: number, cents: number | undefined, color: string) => (
    <View style={styles.label}>
      <ThemedText type="small" numberOfLines={1} style={{ color }}>
        {name}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={1} style={{ color }}>
        {pct}%{cents === undefined ? '' : ` · ${formatCents(cents, CURRENCY)}`}
      </ThemedText>
    </View>
  );

  return (
    <View style={{ gap: 6 }}>
      <View
        ref={bar}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Split"
        accessibilityValue={{ text: `${people.sergio} ${value} percent, ${people.adriana} ${100 - value} percent` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? STEP : -STEP)))
        }
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // Keep the drag even though the form scrolls vertically.
        onResponderTerminationRequest={() => false}
        onResponderGrant={start}
        onResponderMove={(e) => moveTo(e.nativeEvent.pageX)}
        style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
        {/* Sized in percent, so the bar needs no measuring to draw itself. */}
        <View style={[styles.owner, { width: `${value}%`, backgroundColor: theme.tint }]}>
          {value >= MIN_LABEL_PCT ? label(people.sergio, value, ownerCents, '#ffffff') : null}
        </View>
        <View style={styles.other}>
          {100 - value >= MIN_LABEL_PCT ? label(people.adriana, 100 - value, otherCents, theme.text) : null}
        </View>
        {/* The divider handle sits on the boundary; the shift keeps it inside the bar at 0 and 100. */}
        <View
         
          style={[
            styles.handle,
            {
              left: `${value}%`,
              transform: [{ translateX: (-HANDLE_WIDTH * value) / 100 }],
              backgroundColor: '#ffffff',
              borderColor: theme.textSecondary,
            },
          ]}>
          <View style={[styles.grip, { backgroundColor: theme.textSecondary }]} />
          <View style={[styles.grip, { backgroundColor: theme.textSecondary }]} />
        </View>
      </View>

      <View style={styles.ticks}>
        {TICKS.map((t) => (
          <ThemedText key={t} type="small" themeColor="textSecondary" style={styles.tick}>
            {t}
          </ThemedText>
        ))}
      </View>

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary">
          {people.sergio} {value}% · {people.adriana} {100 - value}%
        </ThemedText>
        {value !== DEFAULT_OWNER_SHARE_PCT ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => onChange(DEFAULT_OWNER_SHARE_PCT)}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Back to 50/50
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: HEIGHT, borderRadius: 14, flexDirection: 'row', overflow: 'hidden' },
  // Nothing inside the bar takes touches: the bar itself handles the drag.
  owner: { height: HEIGHT, justifyContent: 'center', pointerEvents: 'none' },
  other: { flex: 1, height: HEIGHT, justifyContent: 'center', pointerEvents: 'none' },
  label: { alignItems: 'center', paddingHorizontal: 12, pointerEvents: 'none' },
  handle: {
    position: 'absolute',
    pointerEvents: 'none',
    top: 0,
    width: HANDLE_WIDTH,
    height: HEIGHT,
    borderRadius: 9,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  grip: { width: 1.5, height: 18, borderRadius: 1 },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontSize: 11, lineHeight: 13 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
