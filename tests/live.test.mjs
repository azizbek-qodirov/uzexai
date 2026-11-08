import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { attachLiveServer } from '../lib/live.mjs';
import { createStore } from '../lib/store.mjs';

function inbox(socket) {
  const queue = [], listeners = new Set();
  socket.on('message', raw => { queue.push(JSON.parse(raw.toString())); for (const check of listeners) check(); });
  return predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Expected WebSocket event did not arrive')); }, 2500);
    function check() {
      const index = queue.findIndex(predicate);
      if (index >= 0) { clearTimeout(timer); listeners.delete(check); resolve(queue.splice(index, 1)[0]); }
    }
    listeners.add(check); check();
  });
}

test('native live bridge: private setup, PCM, transcripts, role-safe tools and confirmations', { timeout: 15000 }, async () => {
  const store = createStore();
  const session = { buyer: { history: [] }, seller: { history: [] }, busy: false, last: Date.now() };
  const sessions = new Map([['test-session', session]]);
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const connection = once(upstream, 'connection');
  const server = http.createServer();
  const bridge = attachLiveServer(server, store, sessions, { GEMINI_API_KEY: 'private-test-key', GEMINI_LIVE_MODEL: 'test-live-model' }, `ws://127.0.0.1:${upstream.address().port}`);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new WebSocket(origin.replace('http:', 'ws:') + '/api/live?role=buyer', { headers: { Cookie: 'uzex_session=test-session', Origin: origin } });
  const receive = inbox(client);
  try {
    const [provider] = await connection;
    const fromBridge = inbox(provider);
    const setup = await fromBridge(e => e.setup);
    assert.equal(setup.setup.model, 'models/test-live-model');
    assert.deepEqual(setup.setup.generationConfig.responseModalities, ['AUDIO']);
    assert.ok(!setup.setup.tools[0].functionDeclarations.some(d => d.name === 'prepare_listing'));
    provider.send(JSON.stringify({ setupComplete: {} }));
    await receive(e => e.type === 'ready');
    client.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(3200).toString('base64') }));
    const audio = await fromBridge(e => e.realtimeInput?.audio);
    assert.equal(audio.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
    assert.equal(Buffer.from(audio.realtimeInput.audio.data, 'base64').length, 3200);
    provider.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'search-1', name: 'search_lots', args: { query: 'sement', region: 'Toshkent' } }] } }));
    const offers = await receive(e => e.type === 'tools');
    assert.equal(offers.cards[0].lots[0].id, 'LOT-1001');
    assert.doesNotMatch(offers.cards[0].lots[0].seller, /demo/i);
    const toolResult = await fromBridge(e => e.toolResponse);
    assert.equal(toolResult.toolResponse.functionResponses[0].id, 'search-1');
    provider.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'wrong-role', name: 'prepare_listing', args: { name: 'Sement', region: 'Toshkent', quantity: 1, price: 1 } }] } }));
    const rejected = await fromBridge(e => e.toolResponse);
    assert.match(rejected.toolResponse.functionResponses[0].response.error, /Sotuvchi/);
    provider.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'order-1', name: 'prepare_order', args: { lot_id: 'LOT-1001', quantity: 10 } }] } }));
    const prepared = await receive(e => e.type === 'tools' && e.cards[0]?.type === 'action');
    const id = prepared.cards[0].action.id;
    assert.equal(store.execute('account_overview', {}, 'test-session', 'buyer').orders.length, 0);
    provider.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'O‘n tonna sement kerak.' }, outputTranscription: { text: 'So‘rovingiz tayyor.' }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] }, turnComplete: true } }));
    const transcript = await receive(e => e.type === 'transcript' && e.who === 'user');
    assert.equal(transcript.text, 'O‘n tonna sement kerak.');
    assert.equal((await receive(e => e.type === 'audio')).mimeType, 'audio/pcm;rate=24000');
    await receive(e => e.type === 'turnComplete');
    assert.equal(session.buyer.history[0].parts[0].text, 'O‘n tonna sement kerak.');
    // A model call alone cannot approve a transaction.
    provider.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'no-consent', name: 'resolve_action', args: { action_id: id, decision: 'confirm' } }] } }));
    const noConsent = await fromBridge(e => e.toolResponse?.functionResponses[0]?.id === 'no-consent');
    assert.match(noConsent.toolResponse.functionResponses[0].response.error, /ovozli/);
    assert.equal(store.execute('account_overview', {}, 'test-session', 'buyer').orders.length, 0);
    // Handle transcript and confirmation in the same provider frame, including order of processing.
    provider.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Ha, tasdiqlayman.' } }, toolCall: { functionCalls: [{ id: 'spoken-confirm', name: 'resolve_action', args: { action_id: id, decision: 'confirm' } }] } }));
    const confirmed = (await receive(e => e.type === 'action')).action;
    assert.equal(confirmed.status, 'confirmed');
    const resolved = await fromBridge(e => e.toolResponse?.functionResponses[0]?.id === 'spoken-confirm');
    assert.equal(resolved.toolResponse.functionResponses[0].response.status, 'confirmed');
    assert.equal(store.execute('account_overview', {}, 'test-session', 'buyer').orders.length, 1);
    assert.throws(() => store.confirm(id, 'test-session', 'buyer'));
    session.live.notifyAction(confirmed);
    const notification = await fromBridge(e => e.clientContent?.turnComplete);
    assert.match(notification.clientContent.turns[0].parts[0].text, /confirmed/);
    client.send(JSON.stringify({ type: 'mute' }));
    await fromBridge(e => e.realtimeInput?.audioStreamEnd);
    const ended = once(provider, 'close'); client.close(); await ended;
    assert.equal(session.live, undefined);
  } finally {
    client.terminate();
    for (const c of bridge.clients) c.terminate();
    for (const c of upstream.clients) c.terminate();
    await new Promise(resolve => bridge.close(resolve));
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    store.close();
  }
});

test('live voice without a configured key fails clearly without contacting Google', { timeout: 5000 }, async () => {
  const store = createStore(); const server = http.createServer();
  const sessions = new Map([['test-session', { buyer: { history: [] }, seller: { history: [] } }]]);
  const bridge = attachLiveServer(server, store, sessions, {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/live?role=buyer`, { headers: { Cookie: 'uzex_session=test-session' } });
  const receive = inbox(client);
  try { assert.match((await receive(e => e.type === 'error')).message, /GEMINI_API_KEY/); }
  finally { client.terminate(); for (const c of bridge.clients) c.terminate(); await new Promise(resolve => bridge.close(resolve)); await new Promise(resolve => server.close(resolve)); store.close(); }
});
