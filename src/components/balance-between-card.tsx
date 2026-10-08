import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { balanceSentence } from '@/components/split-label';
import { ThemedText } from '@/components/themed-text';
import { Card, Money } from '@/components/ui';
import { useBalance } from '@/hooks/use-balance';
import { useTheme } from '@/hooks/use-theme';

/** Who owes whom right now. Opens the Balance screen to see why and to settle up. */
export function BalanceBetweenCard() {
  const theme = useTheme();
  const { data } = useBalance();
  if (!data) return null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/balance')}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <ThemedText type="small" themeColor="textSecondary">
            Between you two
          </ThemedText>
          <ThemedText type="smallBold" style={{ fontSize: 16 }}>
            {balanceSentence(data.balance)}
          </ThemedText>
        </View>
        {data.balance ? (
          <Money cents={data.balance.amountCents} type="smallBold" />
        ) : (
          <ThemedText type="small" style={{ color: theme.good }}>
            Nothing owed
          </ThemedText>
        )}
      </Card>
    </Pressable>
  );
}
