import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Chips } from '@/components/ui';
import { formatDay, shiftDay, todayISO, type ISODate } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

/** Web version of DateField: the browser's own date input instead of the native picker. */
export function DateField({ value, onChange }: { value: ISODate; onChange: (date: ISODate) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <QuickDays value={value} onChange={onChange} />
      <Card style={styles.row}>
        <ThemedText>{formatDay(value)}</ThemedText>
        {createElement('input', {
          type: 'date',
          value,
          'aria-label': 'Date',
          // Clearing the input gives '', which is not a date: keep the current one.
          onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: 16,
            color: theme.text,
            backgroundColor: theme.backgroundSelected,
            border: 'none',
            borderRadius: 8,
            padding: '6px 10px',
            colorScheme: 'light dark',
          },
        })}
      </Card>
    </View>
  );
}

export function QuickDays({ value, onChange }: { value: ISODate; onChange: (date: ISODate) => void }) {
  const today = todayISO();
  const yesterday = shiftDay(today, -1);
  return (
    <Chips
      options={[
        { value: today, label: 'Today' },
        { value: yesterday, label: 'Yesterday' },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
});
