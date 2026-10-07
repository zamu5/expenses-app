import { useSQLiteContext } from 'expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Field, Screen, ToggleRow } from '@/components/ui';
import {
  createCategory,
  getCategory,
  setCategoryArchived,
  updateCategory,
} from '@/db/repositories/categories';
import type { Category } from '@/db/types';
import { useDbQuery } from '@/hooks/use-db-query';

/** Create a category, or edit one when opened with ?id=. */
export default function CategoryEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data } = useDbQuery(async (db) => ({ category: id ? await getCategory(db, id) : null }), [id]);
  if (!data) return null;
  return <CategoryForm category={data.category} />;
}

function CategoryForm({ category }: { category: Category | null }) {
  const db = useSQLiteContext();
  const [name, setName] = useState(category?.name ?? '');
  const [isFixed, setIsFixed] = useState(category?.isFixed ?? false);
  const canSave = name.trim().length > 0;

  async function save() {
    if (!canSave) return;
    try {
      if (category) await updateCategory(db, category.id, { name, isFixed });
      else await createCategory(db, { name, isFixed });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleArchived() {
    if (!category) return;
    await setCategoryArchived(db, category.id, !category.archivedAt);
    router.back();
  }

  return (
    <Screen>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Groceries" autoFocus={!category} />
      <ToggleRow
        label="Fixed cost"
        hint="Paid once a month, like rent. The app won't track its pace."
        value={isFixed}
        onValueChange={setIsFixed}
      />
      <View style={{ gap: 8, marginTop: 8 }}>
        <Button title={category ? 'Save changes' : 'Add category'} onPress={save} disabled={!canSave} />
        {category ? (
          <>
            <Button
              title={category.archivedAt ? 'Restore category' : 'Archive category'}
              variant={category.archivedAt ? 'secondary' : 'destructive'}
              onPress={toggleArchived}
            />
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              Archiving hides it from new expenses. Past expenses and budgets are kept.
            </ThemedText>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
