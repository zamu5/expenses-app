import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, SectionLabel } from '@/components/ui';
import { listCategories } from '@/db/repositories/categories';
import type { Category } from '@/db/types';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';

/** Every category, to rename, archive or add one. Opened from the month's plan. */
export default function CategoriesScreen() {
  const { data: categories } = useDbQuery((db) => listCategories(db, { includeArchived: true }), []);
  const active = categories?.filter((c) => !c.archivedAt) ?? [];
  const archived = categories?.filter((c) => c.archivedAt) ?? [];

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Fixed costs are paid once a month (rent, subscriptions). Variable costs are spread over the
        month, so the app tracks how fast you spend them. Categories that are not monthly only show
        in the months you add them to, from that month's plan.
      </ThemedText>

      <CategoryList categories={active} />
      <Button title="Add category" onPress={() => router.push('/category-edit')} />

      {archived.length > 0 ? (
        <>
          <SectionLabel>Archived</SectionLabel>
          <CategoryList categories={archived} />
        </>
      ) : null}
    </Screen>
  );
}

function CategoryList({ categories }: { categories: Category[] }) {
  const theme = useTheme();
  if (categories.length === 0) return null;
  return (
    <Card style={{ gap: 0, paddingVertical: 4 }}>
      {categories.map((c, i) => (
        <Pressable
          key={c.id}
          onPress={() => router.push({ pathname: '/category-edit', params: { id: c.id } })}
          style={({ pressed }) => [
            styles.row,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
            { opacity: pressed ? 0.6 : 1 },
          ]}>
          <ThemedText style={{ flex: 1 }}>{c.name}</ThemedText>
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              {c.isFixed ? 'Fixed' : 'Variable'}
              {c.isMonthly ? '' : ' · Not monthly'}
            </ThemedText>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
});
