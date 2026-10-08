import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { migrate } from '@/db/migrations';

SplashScreen.preventAutoHideAsync();

/** Hides the splash screen once the database is migrated and the first screen can render. */
function HideSplash() {
  useEffect(() => {
    SplashScreen.hide();
  }, []);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Opens expenses.db on the phone and runs pending migrations before anything renders. */}
      <SQLiteProvider databaseName="expenses.db" onInit={migrate}>
        <HideSplash />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="category/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen name="expense" options={{ presentation: 'modal', title: 'Expense' }} />
          <Stack.Screen name="income" options={{ presentation: 'modal', title: 'Income' }} />
          <Stack.Screen name="account-edit" options={{ presentation: 'modal', title: '' }} />
          <Stack.Screen name="plan" options={{ presentation: 'modal', title: 'Plan month' }} />
          <Stack.Screen name="category-edit" options={{ presentation: 'modal', title: 'Category' }} />
          <Stack.Screen name="balance" options={{ presentation: 'modal', title: 'Balance' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', title: 'Backup' }} />
        </Stack>
      </SQLiteProvider>
    </ThemeProvider>
  );
}
