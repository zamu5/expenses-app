import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Chips, Field } from '@/components/ui';
import type { PeopleNames } from '@/db/repositories/settings';
import { parseSharePct } from '@/domain/split';
import { useTheme } from '@/hooks/use-theme';

const QUICK = ['50', '60', '70'];

/**
 * How a shared amount is divided: the first person's share, in percent. Shown on the expense and
 * refund forms only while "For" is shared. Quick choices for the common splits, or any number.
 */
export function ShareField({
  value,
  onChange,
  people,
}: {
  /** What is typed; parse it with parseSharePct(). */
  value: string;
  onChange: (text: string) => void;
  people: PeopleNames;
}) {
  const theme = useTheme();
  const pct = parseSharePct(value);
  return (
    <View style={{ gap: 8 }}>
      <Chips
        options={QUICK.map((q) => ({ value: q, label: `${q}/${100 - Number(q)}` }))}
        value={QUICK.includes(value.trim()) ? value.trim() : null}
        onChange={onChange}
      />
      <Field
        label={`${people.sergio}'s share (%)`}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        maxLength={3}
      />
      {pct === null ? (
        <ThemedText type="small" style={{ color: theme.critical }}>
          Type a whole number from 0 to 100.
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {people.sergio} {pct}% · {people.adriana} {100 - pct}%
        </ThemedText>
      )}
    </View>
  );
}
