import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Chips } from '@/components/ui';
import { formatDay, shiftDay, toDate, todayISO, type ISODate } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

/**
 * Picks a day: Today / Yesterday for the common case, and the system calendar for any other date.
 * The web version lives in date-field.web.tsx because the native picker does not exist there.
 */
export function DateField({ value, onChange }: { value: ISODate; onChange: (date: ISODate) => void }) {
  const theme = useTheme();

  return (
    <View style={{ gap: 8 }}>
      <QuickDays value={value} onChange={onChange} />
      <Card style={styles.row}>
        <ThemedText>{formatDay(value)}</ThemedText>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={toDate(value)}
            mode="date"
            display="compact"
            accentColor={theme.tint}
            onValueChange={(_event, date) => onChange(todayISO(date))}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() =>
              DateTimePickerAndroid.open({
                value: toDate(value),
                mode: 'date',
                onValueChange: (_event, date) => onChange(todayISO(date)),
              })
            }>
            <ThemedText style={{ color: theme.tint }}>Change</ThemedText>
          </Pressable>
        )}
      </Card>
    </View>
  );
}

/** Today / Yesterday chips, shared by the native and web date fields. */
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
