import { getSplitTotals } from '@/db/repositories/settlements';
import { balanceCents, describeBalance } from '@/domain/split';

import { useDbQuery } from './use-db-query';

/** The running balance between the two people, across every month. */
export function useBalance() {
  return useDbQuery(async (db) => {
    const totals = await getSplitTotals(db);
    return { totals, balance: describeBalance(balanceCents(totals)) };
  }, []);
}
