import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { migrate } from '@/db/migrations';
import { getPeopleNames } from '@/db/repositories/settings';
import { useDbQuery } from '@/hooks/use-db-query';
import { usePeopleStore } from '@/store/people';

SplashScreen.preventAutoHideAsync();

/** Hides the splash screen once the database is migrated and the first screen can render. */
function HideSplash() {
  useEffect(() => {
    SplashScreen.hide();
  }, []);
  return null;
}

/** Keeps the two display names in the store in step with the database. */
function PeopleLoader() {
  const { data } = useDbQuery(getPeopleNames, []);
  const setNames = usePeopleStore((s) => s.setNames);
  useEffect(() => {
    if (data) setNames(data);
  }, [data, setNames]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Opens expenses.db on the phone and runs pending migrations before anything renders. */}
      <SQLiteProvider databaseName="expenses.db" onInit={migrate}>
        <HideSplash />
        <PeopleLoader />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="category/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen name="expense" options={{ presentation: 'modal', title: 'Expense' }} />
          <Stack.Screen name="income" options={{ presentation: 'modal', title: 'Income' }} />
          <Stack.Screen name="account-edit" options={{ presentation: 'modal', title: '' }} />
          <Stack.Screen name="pay-card" options={{ presentation: 'modal', title: 'Pay credit card' }} />
          <Stack.Screen name="plan" options={{ presentation: 'modal', title: 'Plan month' }} />
          <Stack.Screen name="categories" options={{ presentation: 'modal', title: 'Categories' }} />
          <Stack.Screen name="category-edit" options={{ presentation: 'modal', title: 'Category' }} />
          <Stack.Screen name="balance" options={{ presentation: 'modal', title: 'Balance' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', title: 'Settings' }} />
        </Stack>
      </SQLiteProvider>
    </ThemeProvider>
  );
}
