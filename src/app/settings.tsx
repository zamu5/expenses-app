import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, SectionLabel } from '@/components/ui';
import { LATEST_SCHEMA_VERSION } from '@/db/migrations';
import { exportBackup, getLastBackupAt, restoreBackup, setLastBackupAt } from '@/db/repositories/backup';
import { backupFileName, parseBackup, summarizeBackup, type Backup } from '@/domain/backup';
import { todayISO } from '@/domain/dates';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { pickBackupFile, saveBackupFile } from '@/lib/backup-file';

const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** Export all data to a file, and restore it from one. The data only lives on this device otherwise. */
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: lastBackupAt } = useDbQuery(getLastBackupAt, []);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  // A picked backup waits here until the user confirms replacing everything.
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) =>
    setMessage({ text: e instanceof Error ? e.message : String(e), isError: true });

  async function exportNow() {
    setBusy(true);
    setMessage(null);
    try {
      const backup = await exportBackup(db);
      await saveBackupFile(backupFileName(todayISO()), JSON.stringify(backup));
      await setLastBackupAt(db, backup.exportedAt);
      setMessage({ text: 'Backup exported. Keep the file somewhere safe.', isError: false });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    setMessage(null);
    setPending(null);
    try {
      const text = await pickBackupFile();
      if (text === null) return;
      const parsed = parseBackup(text, LATEST_SCHEMA_VERSION);
      if (parsed.ok) setPending(parsed.backup);
      else setMessage({ text: parsed.error, isError: true });
    } catch (e) {
      fail(e);
    }
  }

  async function restore() {
    if (!pending) return;
    setBusy(true);
    try {
      await restoreBackup(db, pending);
      setPending(null);
      setMessage({ text: 'Backup restored.', isError: false });
    } catch (e) {
      setMessage({
        text: `Nothing was changed. The backup could not be restored: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const summary = pending ? summarizeBackup(pending) : null;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Your data is stored only on this device. A backup is one file with everything in it, which
        you can keep in iCloud Drive or anywhere else, and restore on this or another device.
      </ThemedText>

      <SectionLabel>Back up</SectionLabel>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Last backup
        </ThemedText>
        <ThemedText type="smallBold">{lastBackupAt ? formatWhen(lastBackupAt) : 'Never'}</ThemedText>
      </Card>
      <Button title="Export backup" onPress={exportNow} disabled={busy} />

      <SectionLabel>Restore</SectionLabel>
      <Button title="Restore from backup…" variant="secondary" onPress={pick} disabled={busy} />

      {summary ? (
        <Card style={{ gap: 12 }}>
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              Backup made on
            </ThemedText>
            <ThemedText type="smallBold">{formatWhen(summary.exportedAt)}</ThemedText>
          </View>
          <View style={{ gap: 4 }}>
            {summary.counts.map((c) => (
              <View key={c.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText type="small" themeColor="textSecondary">
                  {c.label}
                </ThemedText>
                <ThemedText type="small">{c.count}</ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" style={{ color: theme.critical }}>
            Restoring replaces everything in the app with this backup. What you have now is deleted.
          </ThemedText>
          <Button title="Replace all my data with this backup" variant="destructive" onPress={restore} disabled={busy} />
          <Button title="Cancel" variant="secondary" onPress={() => setPending(null)} disabled={busy} />
        </Card>
      ) : null}

      {message ? (
        <ThemedText type="small" style={{ color: message.isError ? theme.critical : theme.good }}>
          {message.text}
        </ThemedText>
      ) : null}
    </Screen>
  );
}
