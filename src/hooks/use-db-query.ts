import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { subscribeToDataChanges } from '@/db/events';
import type { Db } from '@/db/types';

/**
 * Runs an async database query and re-runs it whenever `deps` change or any repository writes.
 * Screens never keep their own copy of the data: SQLite is the single source of truth.
 */
export function useDbQuery<T>(
  query: (db: Db) => Promise<T>,
  deps: readonly unknown[],
): { data: T | undefined; error: Error | undefined } {
  const db = useSQLiteContext();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);

  useEffect(() => subscribeToDataChanges(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    // Ignore results that arrive after a newer query started (or after the screen closed).
    let current = true;
    query(db).then(
      (result) => {
        if (current) {
          setData(result);
          setError(undefined);
        }
      },
      (e: unknown) => {
        if (current) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);

  return { data, error };
}
