import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Money, SectionLabel } from '@/components/ui';
import type { Income } from '@/db/types';
import { formatDay } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

/** The month's income, one row each. Tapping a row opens it to change the amount or delete it. */
export function IncomeList({ incomes }: { incomes: Income[] }) {
  const theme = useTheme();
  if (incomes.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.between}>
        <SectionLabel>Income · tap to edit</SectionLabel>
        <Money
          cents={incomes.reduce((sum, i) => sum + i.amountCents, 0)}
          type="small"
          color={theme.good}
        />
      </View>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {incomes.map((income, i) => (
          <Pressable
            key={income.id}
            accessibilityRole="button"
            accessibilityLabel={`Edit income ${income.note ?? ''}`}
            onPress={() => router.push({ pathname: '/income', params: { id: income.id } })}
            style={({ pressed }) => [
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
              { opacity: pressed ? 0.6 : 1 },
            ]}>
            <View style={{ flex: 1 }}>
              <ThemedText>{income.note ?? 'Income'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDay(income.receivedOn)}
              </ThemedText>
            </View>
            <ThemedText style={{ color: theme.good }}>+</ThemedText>
            <Money cents={income.amountCents} color={theme.good} />
            <ThemedText style={{ color: theme.tint }}>Edit</ThemedText>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
