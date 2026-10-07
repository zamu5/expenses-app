import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatMonth, monthKeyOf, todayISO } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';
import { useUiStore } from '@/store/ui';

/** ‹ October 2026 › — every screen shows the month selected here. */
export function MonthSwitcher() {
  const theme = useTheme();
  const { selectedMonth, shiftSelectedMonth, setSelectedMonth } = useUiStore();
  const thisMonth = monthKeyOf(todayISO());

  const arrow = (label: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={delta < 0 ? 'Previous month' : 'Next month'}
      hitSlop={12}
      onPress={() => shiftSelectedMonth(delta)}>
      <ThemedText style={[styles.arrow, { color: theme.tint }]}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {arrow('‹', -1)}
      <Pressable onPress={() => setSelectedMonth(thisMonth)} style={styles.center}>
        <ThemedText type="smallBold" style={{ fontSize: 17 }}>
          {formatMonth(selectedMonth)}
        </ThemedText>
        {selectedMonth !== thisMonth ? (
          <ThemedText type="small" style={{ color: theme.tint }}>
            Back to this month
          </ThemedText>
        ) : null}
      </Pressable>
      {arrow('›', 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  center: { flex: 1, alignItems: 'center' },
  arrow: { fontSize: 32, lineHeight: 36, paddingHorizontal: Spacing.two },
});
