import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.mjs';
import { createAssistant } from '../lib/assistant.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('existing lot IDs migrate with pending actions, orders and stock preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uzex-migration-'));
  const path = join(dir, 'fixture.sqlite');
  let store = createStore(path);
  try {
    const order = store.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 10 }, 'a', 'buyer').action;
    store.confirm(order.id, 'a', 'buyer');
    const pending = store.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 5 }, 'a', 'buyer').action;
    store.close(); store = null;
    const legacy = new DatabaseSync(path);
    legacy.exec(`UPDATE lots SET id=replace(id,'LOT-','DEMO-'),seller=seller || ' · demo';
      UPDATE orders SET lot_id=replace(lot_id,'LOT-','DEMO-');
      UPDATE actions SET payload=replace(payload,'LOT-','DEMO-');`);
    legacy.close();
    store = createStore(path);
    const account = store.execute('account_overview', {}, 'a', 'buyer');
    assert.equal(account.orders[0].lot_id, 'LOT-1001');
    assert.equal(account.balance, 492800000);
    const lots = store.execute('search_lots', { query: 'sement', region: 'Toshkent' }, 'a', 'buyer').lots;
    assert.equal(lots[0].quantity, 230);
    assert.doesNotMatch(lots[0].seller, /demo/i);
    store.confirm(pending.id, 'a', 'buyer');
    assert.equal(store.execute('account_overview', {}, 'a', 'buyer').orders.length, 2);
    store.close(); store = createStore(path);
    assert.equal(store.execute('search_lots', { query: 'sement', region: 'Toshkent' }, 'a', 'buyer').lots[0].quantity, 225);
  } finally {
    store?.close();
    for (const name of readdirSync(dir)) unlinkSync(join(dir, name));
    rmdirSync(dir);
  }
});

test('buyer search, prepare, explicit confirmation and duplicate protection', () => {
  const s = createStore();
  try {
    const lots = s.execute('search_lots', { query: 'sement', region: 'Toshkent', quantity: 20 }, 'a', 'buyer').lots;
    assert.equal(lots.length, 1);
    const { action } = s.execute('prepare_order', { lot_id: lots[0].id, quantity: 20 }, 'a', 'buyer');
    assert.equal(s.execute('account_overview', {}, 'a', 'buyer').orders.length, 0);
    assert.throws(() => s.confirm(action.id, 'other-session', 'buyer'));
    assert.throws(() => s.confirm(action.id, 'a', 'seller'));
    s.confirm(action.id, 'a', 'buyer');
    const a = s.execute('account_overview', {}, 'a', 'buyer');
    assert.equal(a.orders.length, 1);
    assert.equal(a.balance, 500000000 - 20 * 720000);
    assert.throws(() => s.confirm(action.id, 'a', 'buyer'));
    assert.equal(s.execute('account_overview', {}, 'a', 'buyer').balance, a.balance);
  } finally { s.close(); }
});

test('seller permissions, validation, cancellation and session isolation', () => {
  const s = createStore();
  const p = { name: 'Test sement', region: 'Toshkent', quantity: 20, price: 700000 };
  try {
    assert.throws(() => s.execute('prepare_listing', p, 'a', 'buyer'));
    assert.throws(() => s.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 1 }, 'a', 'seller'));
    assert.throws(() => s.execute('prepare_listing', { ...p, quantity: -1 }, 'a', 'seller'));
    assert.throws(() => s.execute('prepare_listing', { ...p, price: Infinity }, 'a', 'seller'));
    assert.throws(() => s.execute('execute_sql', {}, 'a', 'seller'));
    const { action } = s.execute('prepare_listing', p, 'a', 'seller');
    s.cancel(action.id, 'a', 'seller');
    assert.throws(() => s.confirm(action.id, 'a', 'seller'));
    const next = s.execute('prepare_listing', p, 'a', 'seller').action;
    s.confirm(next.id, 'a', 'seller');
    assert.equal(s.execute('account_overview', {}, 'a', 'seller').listings.length, 1);
    assert.equal(s.execute('account_overview', {}, 'b', 'seller').listings.length, 0);
  } finally { s.close(); }
});

test('stock and balance rechecked atomically at confirmation', () => {
  const s = createStore();
  try {
    const a = s.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 200 }, 'a', 'buyer').action;
    const b = s.execute('prepare_order', { lot_id: 'LOT-1001', quantity: 200 }, 'b', 'buyer').action;
    s.confirm(a.id, 'a', 'buyer');
    assert.throws(() => s.confirm(b.id, 'b', 'buyer'));
    assert.equal(s.execute('account_overview', {}, 'b', 'buyer').balance, 500000000);
    assert.equal(s.execute('search_lots', { query: 'sement', region: 'Toshkent' }, 'b', 'buyer').lots[0].quantity, 40);
    const first = s.execute('prepare_order', { lot_id: 'LOT-1006', quantity: 4 }, 'c', 'buyer').action;
    const second = s.execute('prepare_order', { lot_id: 'LOT-1006', quantity: 4 }, 'c', 'buyer').action;
    s.confirm(first.id, 'c', 'buyer');
    assert.throws(() => s.confirm(second.id, 'c', 'buyer'));
    assert.equal(s.execute('search_lots', { query: 'mis' }, 'c', 'buyer').lots[0].quantity, 36);
  } finally { s.close(); }
});

test('offline demo collects listing fields across turns and prepares buyer order', async () => {
  const s = createStore();
  const ai = createAssistant(s, { AI_MODE: 'demo' });
  try {
    const seller = { history: [] };
    const first = await ai.chat('100 tonna sement sotaman', seller, 'a', 'seller');
    assert.match(first.text, /narxi/);
    const second = await ai.chat('Toshkent, tonnasi 720000 so‘m', seller, 'a', 'seller');
    assert.equal(second.cards[0].action.quantity, 100);
    assert.equal(second.cards[0].action.price, 720000);
    const buyer = { history: [] };
    const search = await ai.chat('Toshkentdan 20 tonna sement topib bering', buyer, 'a', 'buyer');
    assert.equal(search.cards[0].lots[0].id, 'LOT-1001');
    const purchase = await ai.chat('LOT-1001 dan 20 tonna olaman', buyer, 'a', 'buyer');
    assert.equal(purchase.cards[0].action.total, 14400000);
    assert.equal(s.execute('account_overview', {}, 'a', 'buyer').orders.length, 0);
  } finally { s.close(); }
});

test('Gemini tool roundtrip preserves call metadata and returns database-backed cards', async () => {
  const original = globalThis.fetch;
  const s = createStore();
  const ai = createAssistant(s, { GEMINI_API_KEY: 'test-secret', GEMINI_MODEL: 'test-model' });
  let count = 0;
  globalThis.fetch = async (_url, opts) => {
    const request = JSON.parse(opts.body); count++;
    assert.ok(request.systemInstruction.parts[0].text.includes('Mijoz'));
    assert.ok(!request.tools[0].functionDeclarations.some(t => t.name === 'prepare_listing'));
    if (count === 1) return Response.json({ candidates: [{ content: { role: 'model', parts: [{ thoughtSignature: 'preserve-me', functionCall: { id: 'call-1', name: 'search_lots', args: { query: 'sement' } } }] } }] });
    assert.equal(request.contents[1].parts[0].thoughtSignature, 'preserve-me');
    assert.equal(request.contents[2].parts[0].functionResponse.id, 'call-1');
    assert.equal(request.contents[2].parts[0].functionResponse.response.lots.length, 3);
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'Uchta demo taklif topildi.' }] } }] });
  };
  try {
    const result = await ai.chat('Sement toping', { history: [] }, 'a', 'buyer');
    assert.equal(count, 2); assert.equal(result.engine, 'gemini'); assert.equal(result.cards[0].lots.length, 3);
  } finally { globalThis.fetch = original; s.close(); }
});
