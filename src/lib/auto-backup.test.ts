import { autoBackupUrl, createDebouncedSaver } from './auto-backup';

const fileName = { web: 'latest.json', phone: 'latest-phone.json' };

describe('autoBackupUrl', () => {
  it('uses the page own server in a browser', () => {
    expect(autoBackupUrl({ serverUrl: null, fileName }, 'web', undefined)).toBe('/__backup/latest.json');
  });

  it('uses the Expo dev server on the phone', () => {
    expect(autoBackupUrl({ serverUrl: null, fileName }, 'ios', '192.168.1.20:8082')).toBe(
      'http://192.168.1.20:8082/__backup/latest-phone.json',
    );
  });

  it('has nowhere to send on a phone that was not loaded from a dev server', () => {
    expect(autoBackupUrl({ serverUrl: null, fileName }, 'ios', undefined)).toBeNull();
  });

  it('prefers the configured server', () => {
    expect(autoBackupUrl({ serverUrl: 'http://mac.local:8082/', fileName }, 'ios', undefined)).toBe(
      'http://mac.local:8082/__backup/latest-phone.json',
    );
  });
});

describe('createDebouncedSaver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('saves once for a burst of changes', async () => {
    const save = jest.fn(async () => {});
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    saver.schedule();
    await jest.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    saver.schedule();
    await jest.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves again when a change arrives during a save', async () => {
    let finish = () => {};
    const save = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    await jest.advanceTimersByTimeAsync(1000);
    saver.schedule();
    await jest.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await jest.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not save after it is cancelled', async () => {
    const save = jest.fn(async () => {});
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    saver.cancel();
    await jest.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
