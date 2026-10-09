/**
 * App-wide settings. CURRENCY is your home currency as an ISO 4217 code ('CAD', 'EUR', 'COP', ...):
 * the budget is in it, and the Accounts tab converts every other currency to it for the total.
 * Amounts are stored in cents regardless of currency, so changing this only affects display.
 */
export const CURRENCY = 'CAD';

/**
 * Automatic backup: after every change the app sends a full backup to the dev server, which
 * writes it into the backup folder on the computer (see server/backup-middleware.js). The folder
 * itself is chosen where the server runs, with BACKUP_DIR (see the README).
 */
export const AUTO_BACKUP = {
  enabled: true,
  /**
   * Where the server is, e.g. 'http://192.168.1.20:8082'. null means the server the app was
   * loaded from: this address in a browser, the Expo dev server on the phone.
   */
  serverUrl: null as string | null,
  /**
   * The file each kind of device overwrites. The browser and the phone hold separate data, so
   * they get separate files; give them the same name only if you want the last one to win.
   */
  fileName: { web: 'latest.json', phone: 'latest-phone.json' },
  /** How long to wait after a change before saving, so a burst of changes is saved once. */
  delayMs: 2000,
};
