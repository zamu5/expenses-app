import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CURRENCY } from '@/config';
import { Button, Card, Field, Screen, SectionLabel } from '@/components/ui';
import { LATEST_SCHEMA_VERSION } from '@/db/migrations';
import { exportBackup, getLastBackupAt, restoreBackup, setLastBackupAt } from '@/db/repositories/backup';
import { listAccounts, listExchangeRates, setExchangeRate } from '@/db/repositories/accounts';
import { setPeopleNames, type PeopleNames } from '@/db/repositories/settings';
import type { ExchangeRate } from '@/db/types';
import { backupFileName, parseBackup, summarizeBackup, type Backup } from '@/domain/backup';
import { formatDay, todayISO } from '@/domain/dates';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { pickBackupFile, saveBackupFile } from '@/lib/backup-file';
import { useAutoBackupStore, type AutoBackupStatus } from '@/store/auto-backup';
import { usePeople } from '@/store/people';

const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

function describeAutoBackup(status: AutoBackupStatus): string {
  switch (status.state) {
    case 'off':
      return 'Off: there is no computer to save to from here.';
    case 'waiting':
      return 'On. It saves after your next change.';
    case 'saved':
      return `Saved to ${status.file} on ${formatWhen(status.at)}`;
    case 'failed':
      return `Could not save on ${formatWhen(status.at)}: ${status.error}`;
  }
}

/** The two names, the exchange rates, and exporting all data to a file or restoring it from one. */
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const people = usePeople();
  const autoBackup = useAutoBackupStore((s) => s.status);
  const { data: lastBackupAt } = useDbQuery(getLastBackupAt, []);
  // One rate per currency that an account or planned expense uses, other than the home currency.
  const { data: rates } = useDbQuery(
    async (db) => ({ accounts: await listAccounts(db), rates: await listExchangeRates(db) }),
    [],
  );
  const foreignCurrencies = [
    ...new Set((rates?.accounts ?? []).map((a) => a.currency).filter((c) => c !== CURRENCY)),
  ].sort();
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
      <SectionLabel>People</SectionLabel>
      {/* The key resets the fields when the saved names change, e.g. after restoring a backup. */}
      <PeopleNamesEditor key={`${people.sergio}|${people.adriana}`} names={people} />

      <SectionLabel>Exchange rates</SectionLabel>
      {foreignCurrencies.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          None needed: all your accounts are in {CURRENCY}. A rate appears here when you add an account
          in another currency.
        </ThemedText>
      ) : (
        foreignCurrencies.map((currency) => {
          const rate = rates?.rates.find((r) => r.currency === currency);
          // The key resets the field when the saved rate changes.
          return <RateEditor key={`${currency}-${rate?.unitsPerHome}`} currency={currency} rate={rate} />;
        })
      )}

      <SectionLabel>Backup</SectionLabel>
      <ThemedText type="small" themeColor="textSecondary">
        Your data is stored only on this device. A backup is one file with everything in it, which
        you can keep in iCloud Drive or anywhere else, and restore on this or another device.
      </ThemedText>

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Automatic backup to the computer
        </ThemedText>
        <ThemedText type="smallBold" style={autoBackup.state === 'failed' ? { color: theme.critical } : undefined}>
          {describeAutoBackup(autoBackup)}
        </ThemedText>
      </Card>

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

/** The names shown for the two people. The first one is whose budget and accounts the app tracks. */
function PeopleNamesEditor({ names }: { names: PeopleNames }) {
  const db = useSQLiteContext();
  const [first, setFirst] = useState(names.sergio);
  const [second, setSecond] = useState(names.adriana);
  const changed = first.trim() !== names.sergio || second.trim() !== names.adriana;
  const valid = first.trim() !== '' && second.trim() !== '' && first.trim() !== second.trim();

  return (
    <View style={{ gap: 8 }}>
      <Field label="Your name (the budget and accounts are yours)" value={first} onChangeText={setFirst} />
      <Field label="The person you share expenses with" value={second} onChangeText={setSecond} />
      {changed && !valid ? (
        <ThemedText type="small" themeColor="textSecondary">
          Both names are needed, and they must be different.
        </ThemedText>
      ) : null}
      {changed ? (
        <Button
          title="Save names"
          onPress={() => setPeopleNames(db, { sergio: first, adriana: second })}
          disabled={!valid}
        />
      ) : null}
    </View>
  );
}

/** "1 CAD = [2950] COP", typed by hand. */
function RateEditor({ currency, rate }: { currency: string; rate?: ExchangeRate }) {
  const db = useSQLiteContext();
  const [text, setText] = useState(rate ? String(rate.unitsPerHome) : '');
  const [error, setError] = useState<string | null>(null);
  const parsed = Number(text.trim().replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
  const changed = valid && parsed !== rate?.unitsPerHome;

  async function save() {
    if (!valid) return;
    try {
      await setExchangeRate(db, { currency, unitsPerHome: parsed, setOn: todayISO() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Field
        label={`1 ${CURRENCY} = how many ${currency}?`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        placeholder="0"
      />
      <ThemedText type="small" themeColor="textSecondary">
        {rate ? `Rate set on ${formatDay(rate.setOn)}. Update it whenever you like.` : 'No rate yet.'}
      </ThemedText>
      {error ? (
        <ThemedText type="small" themeColor="textSecondary">
          Could not save: {error}
        </ThemedText>
      ) : null}
      {changed ? <Button title={`Save ${currency} rate`} onPress={save} /> : null}
    </View>
  );
}
