import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.mjs';
import { createVoiceActions, spokenDecision } from '../lib/voice-actions.mjs';

test('spoken consent accepts direct decisions and rejects conditional or ambiguous speech', () => {
  for (const text of ['Ha, tasdiqlayman.', 'Tasdiqlang', 'Buyurtmani tasdiqlayman', 'yes, I confirm', 'да подтверждаю']) assert.equal(spokenDecision(text), 'confirm', text);
  for (const text of ['Bekor qiling.', 'Yo‘q', 'buyurtmani bekor qil', 'No, cancel it', 'отменить']) assert.equal(spokenDecision(text), 'cancel', text);
  for (const text of ['', 'Ha lekin narxini o‘zgartiring', 'tasdiqlash haqida ayting', 'Men aytmaguncha tasdiqlama', 'yes if the price drops', '100 tonna olaman']) assert.equal(spokenDecision(text), null, text);
});

test('a voice action requires fresh consent for the exact currently reviewed card', () => {
  const store = createStore(); const events = [];
  const actions = createVoiceActions(store, 'a', 'buyer', e => events.push(e));
  try {
    const first = store.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 10 }, 'a', 'buyer').action;
    actions.input('Ha, tasdiqlayman.'); actions.present(first);
    assert.throws(() => actions.resolve({ action_id: first.id, decision: 'confirm' }));
    actions.input('Ha lekin narxini o‘zgartiring');
    assert.throws(() => actions.resolve({ action_id: first.id, decision: 'confirm' }));
    actions.endTurn();
    const second = store.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 5 }, 'a', 'buyer').action;
    actions.present(second); actions.input('Ha, tasdiqlayman.');
    assert.throws(() => actions.resolve({ action_id: first.id, decision: 'confirm' }));
    actions.review(first.id); // Selecting a card never supplies consent.
    assert.throws(() => actions.resolve({ action_id: first.id, decision: 'confirm' }));
    actions.input('Ha, tasdiqlayman.');
    const result = actions.resolve({ action_id: first.id, decision: 'confirm' });
    assert.equal(result.status, 'confirmed'); assert.equal(events.length, 1);
    assert.throws(() => actions.resolve({ action_id: first.id, decision: 'confirm' }));
    actions.review(second.id);
    assert.throws(() => actions.resolve({ action_id: second.id, decision: 'confirm' }));
    actions.input('Bekor qiling.');
    assert.throws(() => actions.resolve({ action_id: second.id, decision: 'confirm' }));
    assert.equal(actions.resolve({ action_id: second.id, decision: 'cancel' }).status, 'cancelled');
    assert.equal(store.execute('account_overview', {}, 'a', 'buyer').orders.length, 1);
  } finally { store.close(); }
});

test('voice confirmation retains transaction session and role checks', () => {
  const store = createStore();
  try {
    const prepared = store.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 10 }, 'a', 'buyer').action;
    for (const [session, role] of [['b', 'buyer'], ['a', 'seller']]) {
      const actions = createVoiceActions(store, session, role, () => {});
      actions.present(prepared); actions.input('Ha, tasdiqlayman.');
      assert.throws(() => actions.resolve({ action_id: prepared.id, decision: 'confirm' }));
    }
    assert.equal(store.execute('account_overview', {}, 'a', 'buyer').orders.length, 0);
  } finally { store.close(); }
});
