import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CURRENCY } from '@/config';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { CategoryStatus, MonthStatus } from '@/domain/budget';
import { formatCents } from '@/domain/money';
import { useTheme } from '@/hooks/use-theme';

/** A scrolling page with consistent padding. `tabs` leaves room for the tab bar and the + button. */
export function Screen({ children, tabs = false }: { children: ReactNode; tabs?: boolean }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.screen,
        tabs && { paddingBottom: BottomTabInset + Spacing.six + Spacing.four },
      ]}>
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <ThemedText style={styles.title}>{children}</ThemedText>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
      {children}
    </ThemedText>
  );
}

export function Money({
  cents,
  type = 'default',
  color,
}: {
  cents: number;
  type?: 'default' | 'small' | 'smallBold' | 'subtitle';
  color?: string;
}) {
  return (
    <ThemedText type={type} style={[{ fontVariant: ['tabular-nums'] }, color ? { color } : null]}>
      {formatCents(cents, CURRENCY)}
    </ThemedText>
  );
}

export function useStatusColor(status: CategoryStatus | MonthStatus): string {
  const theme = useTheme();
  if (status === 'onTrack') return theme.good;
  if (status === 'watch') return theme.warning;
  return theme.critical;
}

const STATUS_LABEL: Record<CategoryStatus | MonthStatus, string> = {
  onTrack: 'On track',
  watch: 'Watch',
  over: 'Over',
  danger: 'Danger',
};

/** Status is shown with colour AND words, so it still reads for colour-blind users. */
export function StatusPill({ status }: { status: CategoryStatus | MonthStatus }) {
  const color = useStatusColor(status);
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <ThemedText type="smallBold" style={{ color }}>
        {STATUS_LABEL[status]}
      </ThemedText>
    </View>
  );
}

export function ProgressBar({ ratio, color }: { ratio: number; color: string }) {
  const theme = useTheme();
  const width = `${Math.min(Math.max(ratio, 0), 1) * 100}%` as const;
  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.fill, { width, backgroundColor: color }]} />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: PressableProps['onPress'];
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const background =
    variant === 'primary' ? theme.tint : variant === 'destructive' ? 'transparent' : theme.backgroundElement;
  const color = variant === 'primary' ? '#ffffff' : variant === 'destructive' ? theme.critical : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      <ThemedText type="smallBold" style={{ color, fontSize: 17 }}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        {...props}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement },
          props.style,
        ]}
      />
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Card style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <ThemedText>{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </Card>
  );
}

/** Horizontal choice chips, used to pick a category. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? theme.tint : theme.backgroundElement,
              },
            ]}>
            <ThemedText type="small" style={{ color: selected ? '#ffffff' : theme.text }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The round "+" button that floats above the tab bar. */
export function Fab({ onPress, label }: { onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
      <ThemedText style={styles.fabText}>+</ThemedText>
    </Pressable>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card style={{ alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five }}>
      <ThemedText type="smallBold" style={{ fontSize: 17 }}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {body}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, gap: Spacing.three },
  title: { fontSize: 34, lineHeight: 41, fontWeight: 700, marginTop: Spacing.two },
  card: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  sectionLabel: { textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  button: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  field: { gap: Spacing.one },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: BottomTabInset + Spacing.four,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: '#ffffff', fontSize: 34, lineHeight: 38, fontWeight: 400 },
});
