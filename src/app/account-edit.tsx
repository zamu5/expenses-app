import { useSQLiteContext } from 'expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Chips, Field, Screen, SectionLabel, ToggleRow } from '@/components/ui';
import { CURRENCY } from '@/config';
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '@/db/repositories/accounts';
import type { Account, AccountKind } from '@/db/types';
import { parseCurrencyCode } from '@/domain/accounts';
import { todayISO } from '@/domain/dates';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';

/** Create an account or a planned expense (?kind=planned), or edit one when opened with ?id=. */
export default function AccountEditScreen() {
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  const { data } = useDbQuery(
    async (db) => {
      const [account, all] = await Promise.all([id ? getAccount(db, id) : null, listAccounts(db)]);
      // Offer the currencies already in use, so a second account in pesos is one tap.
      const currencies = [...new Set([CURRENCY, ...all.map((a) => a.currency)])];
      return { account, currencies };
    },
    [id],
  );
  if (!data) return null;
  return (
    <AccountForm
      account={data.account}
      kind={data.account?.kind ?? (kind === 'planned' ? 'planned' : 'account')}
      currencies={data.currencies}
    />
  );
}

function AccountForm({
  account,
  kind,
  currencies,
}: {
  account: Account | null;
  kind: AccountKind;
  currencies: string[];
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const isPlanned = kind === 'planned';

  const [name, setName] = useState(account?.name ?? '');
  const [currencyText, setCurrencyText] = useState(account?.currency ?? CURRENCY);
  const [balanceText, setBalanceText] = useState(account ? centsToInputText(account.balanceCents) : '');
  const [isBudgetAccount, setIsBudgetAccount] = useState(account?.isBudgetAccount ?? false);

  const currency = parseCurrencyCode(currencyText);
  // The budget account's balance comes from the monthly budget, so nothing is typed for it.
  const balanceCents = isBudgetAccount ? 0 : balanceText.trim() === '' ? 0 : parseAmountToCents(balanceText);
  const canSave = name.trim() !== '' && currency !== null && balanceCents !== null;

  async function save() {
    if (!canSave) return;
    const input = {
      name,
      kind,
      currency: isBudgetAccount ? CURRENCY : currency,
      balanceCents,
      isBudgetAccount,
      // Keep the "updated" day unless the balance itself changed.
      balanceUpdatedOn:
        account && account.balanceCents === balanceCents ? account.balanceUpdatedOn : todayISO(),
    };
    try {
      if (account) await updateAccount(db, account.id, input);
      else await createAccount(db, input);
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  function confirmDelete() {
    if (!account) return;
    confirmDestructive(`Delete ${account.name}?`, 'Delete', async () => {
      await deleteAccount(db, account.id);
      router.back();
    });
  }

  const noun = isPlanned ? 'planned expense' : 'account';
  return (
    <Screen>
      <Stack.Screen options={{ title: isPlanned ? 'Planned expense' : 'Account' }} />
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder={isPlanned ? 'What are you planning for?' : 'Bank or account name'}
        autoFocus={!account}
      />

      {!isPlanned ? (
        <ToggleRow
          label="Budget account"
          hint={`The account your monthly budget is spent from. Its balance follows the budget, in ${CURRENCY}.`}
          value={isBudgetAccount}
          onValueChange={setIsBudgetAccount}
        />
      ) : null}

      {isBudgetAccount ? null : (
        <>
          <SectionLabel>Currency</SectionLabel>
          <Chips
            options={currencies.map((c) => ({ value: c, label: c }))}
            value={currency}
            onChange={setCurrencyText}
          />
          <Field
            label="Or type a 3-letter code"
            value={currencyText}
            onChangeText={setCurrencyText}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            placeholder="COP"
          />
          {currency === null ? (
            <ThemedText type="small" style={{ color: theme.critical }}>
              Use a 3-letter currency code, like CAD or COP.
            </ThemedText>
          ) : null}

          <Field
            label={isPlanned ? 'How much you expect to spend' : 'Current balance'}
            value={balanceText}
            onChangeText={setBalanceText}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          {balanceCents === null ? (
            <ThemedText type="small" style={{ color: theme.critical }}>
              Enter an amount like 1500.00
            </ThemedText>
          ) : null}
        </>
      )}

      <View style={{ gap: 8, marginTop: 8 }}>
        <Button title={account ? 'Save changes' : `Add ${noun}`} onPress={save} disabled={!canSave} />
        {account ? <Button title={`Delete ${noun}`} variant="destructive" onPress={confirmDelete} /> : null}
      </View>
    </Screen>
  );
}
