import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTP demo: cookies, cards, seller flow, confirmations, origins and static assets', { timeout: 20000 }, async () => {
  const port = 3100 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), AI_MODE: 'demo', DATABASE_PATH: ':memory:' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', b => { if (String(b).includes('http://localhost')) resolve(); });
      child.on('error', reject); child.on('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const config = await fetch(base + '/api/config');
    const cookie = config.headers.get('set-cookie').split(';')[0];
    assert.equal((await config.json()).engine, 'demo');
    async function post(path, data, headers = {}) {
      const response = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: JSON.stringify(data) });
      return { status: response.status, body: await response.json() };
    }
    const html = await fetch(base + '/');
    assert.equal(html.status, 200); assert.match(await html.text(), /Savdo suhbatdan/);
    assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    for (const path of ['/app.js', '/live-voice.js', '/voice-ui.js', '/voice-workspace.js', '/mic-worklet.js', '/markdown.js', '/vendor/markdown-it.js', '/style.css', '/neon.css', '/voice-session.css', '/fonts/fonts.css', '/mark.svg', '/assets/voice/answering.gif', '/assets/voice/listening.gif', '/assets/voice/ready.gif', '/assets/voice/processing.gif']) {
      const asset = await fetch(base + path);
      assert.equal(asset.status, 200);
      if (/\.m?js$/.test(path)) assert.match(asset.headers.get('content-type'), /javascript/);
    }
    const search = await post('chat', { role: 'buyer', text: 'Toshkentdan 20 tonna sement topib bering' });
    assert.equal(search.status, 200); assert.equal(search.body.cards[0].lots.length, 1);
    const order = await post('chat', { role: 'buyer', text: 'LOT-1001 dan 20 tonna olaman' });
    const id = order.body.cards[0].action.id;
    assert.equal((await post('confirm', { role: 'seller', id })).status, 400);
    assert.equal((await post('confirm', { role: 'buyer', id })).body.status, 'confirmed');
    assert.equal((await post('confirm', { role: 'buyer', id })).status, 400);
    const account = await post('chat', { role: 'buyer', text: 'Hisobim holati' });
    assert.equal(account.body.cards[0].balance, 485600000);
    assert.equal(account.body.cards[0].orders.length, 1);
    const listing = await post('chat', { role: 'seller', text: 'Toshkentda 100 tonna M-400 sement sotaman, tonnasi 720000 so‘m' });
    assert.equal(listing.body.cards[0].action.kind, 'listing');
    assert.equal((await post('confirm', { role: 'seller', id: listing.body.cards[0].action.id })).body.status, 'confirmed');
    const seller = await post('chat', { role: 'seller', text: 'E’lonlarim holati' });
    assert.equal(seller.body.cards[0].listings.length, 1);
    assert.equal((await post('chat', { role: 'admin', text: 'test' })).status, 400);
    assert.equal((await post('chat', { role: 'buyer', text: '' })).status, 400);
    assert.equal((await post('chat', { role: 'buyer', text: 'hello' }, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await post('reset', { role: 'buyer' })).status, 200);
    const retained = await post('chat', { role: 'buyer', text: 'Hisobim holati' });
    assert.equal(retained.body.cards[0].orders.length, 1);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
});
