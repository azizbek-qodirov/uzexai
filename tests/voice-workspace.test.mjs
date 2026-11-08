import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { VoiceWorkspace } from '../public/voice-workspace.js';
import { renderMarkdown } from '../public/markdown.js';

test('streaming transcripts do not rebuild or scroll cards, and the reviewed action stays visible', async () => {
  const { document } = parseHTML(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
  const root = document.querySelector('#liveCall'), pane = root.querySelector('#liveCards');
  const transcript = root.querySelector('#liveTranscriptList');
  Object.defineProperties(transcript, { scrollHeight: { value: 400 }, clientHeight: { value: 100 } });
  transcript.scrollTop = 0; pane.scrollTop = 0;
  const workspace = new VoiceWorkspace(root, {
    renderMarkdown,
    renderCard(c) { return c.type === 'action' ? `<div class="action-card"><strong>${c.action.status}</strong>${c.action.status === 'pending' ? '<div class="action-buttons"></div>' : ''}</div>` : '<div class="lot-grid">Offers</div>'; },
    mirrorMessage() { const article = document.createElement('article'); article.innerHTML = '<div class="message-text"></div>'; return article; },
  });
  const action = { id: 'action-1', status: 'pending' };
  workspace.tools({ cards: [{ type: 'lots', lots: [] }, { type: 'action', action }], traces: [] });
  assert.equal(pane.firstElementChild.dataset.resultKey, 'action-1');
  assert.ok(pane.querySelector('[data-review="action-1"]'));
  const original = pane.firstElementChild;
  pane.scrollTop = 87;
  workspace.transcript('assistant', 'So‘rovingiz ');
  workspace.transcript('assistant', 'tayyor.');
  workspace.transcript('user', 'Ha, tasdiqlayman.');
  assert.equal(pane.firstElementChild, original); assert.equal(pane.scrollTop, 87);
  assert.equal(transcript.scrollTop, 0); // Do not pull a reader away from earlier transcript text.
  assert.equal(transcript.querySelectorAll('.voice-transcript-row').length, 2);
  workspace.action({ id: 'action-1', status: 'confirmed' });
  assert.equal(pane.firstElementChild.dataset.resultKey, 'action-1');
  assert.match(pane.firstElementChild.textContent, /confirmed/);
  assert.equal(pane.querySelector('[data-review]'), null);
  assert.equal(pane.scrollTop, 87);
});

test('primary voice entry opens the complete dialog; ending while connecting releases the interface', async () => {
  const { document, window } = parseHTML(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
  const original = { document: globalThis.document, window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), fetch: globalThis.fetch };
  const dialog = document.querySelector('#liveCall');
  window.innerWidth = 1200; window.innerHeight = 800;
  let inputBounds = { right: 1020, top: 650 };
  document.querySelector('.composer').getBoundingClientRect = () => inputBounds;
  let opened = 0, closeCount = 0, resolveConfig;
  dialog.open = false;
  dialog.showModal = () => { opened++; dialog.open = true; };
  dialog.close = () => { closeCount++; dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  window.AudioWorkletNode = class {};
  globalThis.document = document; globalThis.window = window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia() { throw new Error('Ended call must not request microphone'); } } } });
  globalThis.fetch = () => new Promise(resolve => { resolveConfig = resolve; });
  try {
    await import('../public/app.js?voice-ui-test');
    assert.equal(document.querySelector('#engineLabel'), null);
    assert.equal(document.querySelector('#aboutButton'), null);
    assert.equal(document.documentElement.style.getPropertyValue('--voice-dock-right'), '180px');
    assert.equal(document.documentElement.style.getPropertyValue('--voice-dock-bottom'), '162px');
    inputBounds = { right: 1100, top: 610 };
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(document.documentElement.style.getPropertyValue('--voice-dock-right'), '100px');
    assert.equal(document.documentElement.style.getPropertyValue('--voice-dock-bottom'), '202px');
    document.querySelector('#startVoiceMain').click();
    assert.equal(opened, 1); assert.equal(dialog.open, true); assert.equal(dialog.hidden, false);
    assert.ok(document.body.classList.contains('in-voice-session'));
    for (const selector of ['#liveCards', '#liveTranscriptList', '#endLive', '#muteLive', '#interruptLive']) assert.ok(dialog.querySelector(selector));
    document.querySelector('#toggleTranscripts').click();
    assert.equal(document.querySelector('#voiceTranscripts').hidden, true);
    document.querySelector('#endLive').click();
    assert.equal(dialog.open, false); assert.equal(closeCount, 1); assert.equal(dialog.hidden, true);
    assert.ok(!document.body.classList.contains('in-voice-session'));
    resolveConfig(Response.json({ engine: 'gemini' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('#startVoiceMain').getAttribute('aria-pressed'), 'false');
  } finally {
    globalThis.document = original.document; globalThis.window = original.window; globalThis.fetch = original.fetch;
    if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator); else delete globalThis.navigator;
  }
});
