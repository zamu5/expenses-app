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
import type { Account, AccountKind, AccountType } from '@/db/types';
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
      // The default for income belongs to one account; the others do not offer the switch.
      const incomeDefault = all.find((a) => a.isIncomeDefault && a.id !== id) ?? null;
      const paymentDefault = all.find((a) => a.isPaymentDefault && a.id !== id) ?? null;
      return {
        account,
        currencies,
        incomeDefaultName: incomeDefault?.name ?? null,
        paymentDefaultName: paymentDefault?.name ?? null,
        // A credit card is paid from a bank account in the home currency (not from another card).
        banks: all.filter(
          (a) =>
            a.kind === 'account' &&
            a.accountType === 'bank' &&
            a.linkedAccountId === null &&
            a.currency === CURRENCY &&
            a.id !== id,
        ),
      };
    },
    [id],
  );
  if (!data) return null;
  return (
    <AccountForm
      account={data.account}
      kind={data.account?.kind ?? (kind === 'planned' ? 'planned' : 'account')}
      currencies={data.currencies}
      incomeDefaultName={data.incomeDefaultName}
      paymentDefaultName={data.paymentDefaultName}
      banks={data.banks}
    />
  );
}

function AccountForm({
  account,
  kind,
  currencies,
  incomeDefaultName,
  paymentDefaultName,
  banks,
}: {
  account: Account | null;
  kind: AccountKind;
  currencies: string[];
  /** Name of the other account that is already the default for income, if any. */
  incomeDefaultName: string | null;
  /** The same for the default payment method. */
  paymentDefaultName: string | null;
  /** Bank accounts a credit card can be paid from. */
  banks: Account[];
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const isPlanned = kind === 'planned';

  const [name, setName] = useState(account?.name ?? '');
  const [currencyText, setCurrencyText] = useState(account?.currency ?? CURRENCY);
  // A credit card is an account linked to the bank account it is paid from. What is owed on it
  // is typed as a positive amount and stored as a negative balance.
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(account?.linkedAccountId ?? null);
  const [isCardOn, setIsCardOn] = useState(account ? account.linkedAccountId !== null : false);
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType ?? 'bank');
  // Only a bank account can be a credit card.
  const isCard = isCardOn && accountType === 'bank';
  const [balanceText, setBalanceText] = useState(
    account ? centsToInputText(Math.abs(account.balanceCents)) : '',
  );
  const [isPaymentDefault, setIsPaymentDefault] = useState(account?.isPaymentDefault ?? false);
  const [isIncomeDefault, setIsIncomeDefault] = useState(account?.isIncomeDefault ?? false);

  const currency = parseCurrencyCode(currencyText);
  const typedCents = balanceText.trim() === '' ? 0 : parseAmountToCents(balanceText);
  // An existing account keeps its sign unless it is (or becomes) a card, which is always owed.
  const wasNegative = !isCard && account !== null && account.linkedAccountId === null && account.balanceCents < 0;
  const balanceCents = typedCents === null ? null : isCard || wasNegative ? -typedCents || 0 : typedCents;
  const linked = isCard ? banks.find((b) => b.id === linkedAccountId) : undefined;
  const canSave =
    name.trim() !== '' && currency !== null && balanceCents !== null && (!isCard || linked !== undefined);

  async function save() {
    if (!canSave) return;
    const input = {
      name,
      kind,
      accountType,
      currency,
      balanceCents,
      // Never claim the default while another account holds it.
      isIncomeDefault: incomeDefaultName === null && currency === CURRENCY && !isCard && isIncomeDefault,
      linkedAccountId: isCard ? linkedAccountId : null,
      isPaymentDefault:
        paymentDefaultName === null && accountType === 'bank' && currency === CURRENCY && isPaymentDefault,
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

  const noun = isPlanned
    ? 'planned expense'
    : isCard
      ? 'credit card'
      : accountType === 'investment'
        ? 'investment account'
        : 'bank account';
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: isPlanned
            ? 'Planned expense'
            : isCard
              ? 'Credit card'
              : accountType === 'investment'
                ? 'Investment account'
                : 'Bank account',
        }}
      />
      {/* Paying the card has its own screen; this is the way in from the card itself. */}
      {account && account.linkedAccountId ? (
        <Button
          title={`Pay this card (you owe ${centsToInputText(Math.abs(account.balanceCents))})`}
          onPress={() => router.push({ pathname: '/pay-card', params: { id: account.id } })}
        />
      ) : null}

      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder={isPlanned ? 'What are you planning for?' : 'Bank or account name'}
        autoFocus={!account}
      />

      {!isPlanned ? (
        <>
          <SectionLabel>Type</SectionLabel>
          <Chips<AccountType>
            options={[
              { value: 'bank', label: 'Bank account' },
              { value: 'investment', label: 'Investment account' },
            ]}
            value={accountType}
            onChange={setAccountType}
          />
        </>
      ) : null}
      {/* Only a bank account can be a credit card. */}
      {!isPlanned && accountType === 'bank' ? (
        <ToggleRow
          label="This is a credit card"
          hint="What you spend with it is owed, and it is paid from one of your bank accounts."
          value={isCard}
          onValueChange={(value) => {
            setIsCardOn(value);
            if (value) setCurrencyText(CURRENCY);
          }}
        />
      ) : null}
      {isCard ? (
        <>
          <SectionLabel>Paid from</SectionLabel>
          <Chips
            options={banks.map((b) => ({ value: b.id, label: b.name }))}
            value={linkedAccountId}
            onChange={setLinkedAccountId}
          />
          {linked === undefined ? (
            <ThemedText type="small" style={{ color: theme.critical }}>
              {banks.length === 0
                ? `Add a bank account in ${CURRENCY} first, so this card has an account to be paid from.`
                : 'Pick the bank account this card is paid from.'}
            </ThemedText>
          ) : null}
        </>
      ) : null}

      <SectionLabel>Currency</SectionLabel>
      <Chips
        options={(isCard ? [CURRENCY] : currencies).map((c) => ({ value: c, label: c }))}
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
        label={
          isPlanned ? 'How much you expect to spend' : isCard ? 'What you owe on it now' : 'Current balance'
        }
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

      {/* Income is typed in the home currency, so only an account in it can receive income. */}
      {isPlanned || isCard || currency !== CURRENCY ? null : incomeDefaultName === null ? (
        <ToggleRow
          label="Default account for income"
          hint="Pre-selected when you log an income or a refund. Only one account can be the default."
          value={isIncomeDefault}
          onValueChange={setIsIncomeDefault}
        />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {incomeDefaultName} is the default account for income. To change it, switch it off there
          first.
        </ThemedText>
      )}

      {/* Only a bank account or a card pays for things. */}
      {isPlanned || accountType !== 'bank' || currency !== CURRENCY ? null : paymentDefaultName === null ? (
        <ToggleRow
          label="Default payment method"
          hint={'Pre-selected as "Paid with" when you log an expense. Only one can be the default.'}
          value={isPaymentDefault}
          onValueChange={setIsPaymentDefault}
        />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {paymentDefaultName} is the default payment method. To change it, switch it off there first.
        </ThemedText>
      )}

      <View style={{ gap: 8, marginTop: 8 }}>
        <Button title={account ? 'Save changes' : `Add ${noun}`} onPress={save} disabled={!canSave} />
        {account ? <Button title={`Delete ${noun}`} variant="destructive" onPress={confirmDelete} /> : null}
      </View>
    </Screen>
  );
}
