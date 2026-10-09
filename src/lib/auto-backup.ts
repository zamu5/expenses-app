import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { AUTO_BACKUP } from '@/config';
import { subscribeToDataChanges } from '@/db/events';
import { exportBackup } from '@/db/repositories/backup';
import type { Db } from '@/db/types';
import { nowISO } from '@/lib/id';
import { useAutoBackupStore } from '@/store/auto-backup';

/** 'http://192.168.1.20:8082/__backup/latest.json', or null when there is no server to send to. */
export function autoBackupUrl(
  config: Pick<typeof AUTO_BACKUP, 'serverUrl' | 'fileName'>,
  platform: string,
  devServerHost: string | undefined,
  fileOverride?: string | null,
): string | null {
  const file = fileOverride || (platform === 'web' ? config.fileName.web : config.fileName.phone);
  let server: string;
  if (config.serverUrl) server = config.serverUrl.replace(/\/+$/, '');
  // In a browser the page itself came from the server, so a relative address reaches it.
  else if (platform === 'web') server = '';
  else if (devServerHost) server = `http://${devServerHost}`;
  else return null;
  return `${server}/__backup/${file}`;
}

/**
 * The file name this one browser was told to use instead of the configured one, if any. It lets
 * a browser used for testing save to its own file and leave the real backup alone. Set it in the
 * browser's console: localStorage.setItem('autoBackupFile', 'test.json'), then reload.
 */
export function browserFileOverride(): string | null {
  try {
    return Platform.OS === 'web' ? globalThis.localStorage?.getItem(AUTO_BACKUP.overrideKey) || null : null;
  } catch {
    // Storage can be blocked (private windows); the configured name is used then.
    return null;
  }
}

/**
 * Runs `save` once things have been quiet for `delayMs` after `schedule()` is called. A change
 * that arrives while a save is running is saved right after it, so the file never ends up stale.
 */
export function createDebouncedSaver(save: () => Promise<void>, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;

  async function run() {
    timer = null;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await save();
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  }

  return {
    schedule,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      again = false;
    },
  };
}

/**
 * Saves a backup to the server after every change to the data. Nothing is saved when the app
 * merely opens, so an app with no data yet never replaces a good backup just by being started.
 * Returns a function that stops it.
 */
export function startAutoBackup(db: Db): () => void {
  const { setStatus } = useAutoBackupStore.getState();
  const url = AUTO_BACKUP.enabled
    ? autoBackupUrl(AUTO_BACKUP, Platform.OS, Constants.expoConfig?.hostUri, browserFileOverride())
    : null;
  if (!url) {
    setStatus({ state: 'off' });
    return () => {};
  }
  setStatus({ state: 'waiting' });

  const saver = createDebouncedSaver(async () => {
    try {
      const backup = await exportBackup(db);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      });
      if (!response.ok) throw new Error(`The backup server answered ${response.status}.`);
      setStatus({ state: 'saved', at: backup.exportedAt, file: url.slice(url.lastIndexOf('/') + 1) });
    } catch (e) {
      setStatus({ state: 'failed', at: nowISO(), error: e instanceof Error ? e.message : String(e) });
    }
  }, AUTO_BACKUP.delayMs);

  const unsubscribe = subscribeToDataChanges(saver.schedule);
  return () => {
    unsubscribe();
    saver.cancel();
  };
}
