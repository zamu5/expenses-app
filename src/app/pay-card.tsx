import { useSQLiteContext } from 'expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, EmptyState, Field, Money, Screen, SectionLabel } from '@/components/ui';
import { listAccounts, payCard } from '@/db/repositories/accounts';
import type { Account } from '@/db/types';
import { centsToInputText, parseAmountToCents } from '@/domain/money';
import { useDbQuery } from '@/hooks/use-db-query';

/**
 * Pays a credit card: the money comes out of the bank account the card is linked to, and what is
 * owed on the card goes down by the same amount. Opened with ?id= to start on one card.
 */
export default function PayCardScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: accounts } = useDbQuery(listAccounts, []);
  if (!accounts) return null;
  const cards = accounts.filter((a) => a.linkedAccountId !== null);
  if (cards.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="No credit card yet"
          body={'Add an account, switch on "This is a credit card" and pick the bank account it is paid from.'}
        />
      </Screen>
    );
  }
  return <PayCardForm accounts={accounts} cards={cards} initialCardId={id} />;
}

function PayCardForm({
  accounts,
  cards,
  initialCardId,
}: {
  accounts: Account[];
  cards: Account[];
  initialCardId?: string;
}) {
  const db = useSQLiteContext();
  const [cardId, setCardId] = useState(cards.find((c) => c.id === initialCardId)?.id ?? cards[0].id);
  // Empty means "everything that is owed", which is the usual payment.
  const [text, setText] = useState('');

  const card = cards.find((c) => c.id === cardId) ?? cards[0];
  const bank = accounts.find((a) => a.id === card.linkedAccountId);
  const owedCents = Math.max(0, -card.balanceCents);
  const amountCents = text.trim() === '' ? owedCents : parseAmountToCents(text);
  const canPay = amountCents !== null && amountCents > 0 && bank !== undefined;

  async function pay() {
    if (!canPay) return;
    try {
      await payCard(db, card.id, amountCents);
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen>
      {cards.length > 1 ? (
        <>
          <SectionLabel>Card</SectionLabel>
          <Chips options={cards.map((c) => ({ value: c.id, label: c.name }))} value={cardId} onChange={setCardId} />
        </>
      ) : null}

      <Card style={{ gap: 12 }}>
        <Row label={`You owe on ${card.name}`} cents={owedCents} />
        <Row label={`In ${bank?.name ?? 'the linked account'}`} cents={bank?.balanceCents ?? 0} />
      </Card>

      <Field
        label="Amount to pay"
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        placeholder={centsToInputText(owedCents)}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Leave it empty to pay everything you owe. The money comes out of {bank?.name ?? 'the linked account'}
        {' '}and off the card. It is not an expense, so no budget changes.
      </ThemedText>

      <Button
        title={amountCents ? `Pay ${centsToInputText(amountCents)} from ${bank?.name ?? 'the account'}` : 'Pay card'}
        onPress={pay}
        disabled={!canPay}
      />
    </Screen>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Money cents={cents} type="smallBold" />
    </View>
  );
}
