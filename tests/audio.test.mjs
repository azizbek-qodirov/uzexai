import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { LiveVoice } from '../public/live-voice.js';

const callbacks = () => ({ state() {}, error() {}, turn() {}, transcript() {}, tools() {} });

test('streamed PCM playback preserves sample values, timing and interruption', () => {
  const voice = new LiveVoice(callbacks());
  voice.active = true;
  const buffers = [], sources = [];
  voice.audio = {
    currentTime: 1, destination: {}, close: () => Promise.resolve(),
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      const buffer = { channels, rate, duration: length / rate, getChannelData: () => data, data }; buffers.push(buffer); return buffer;
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(t) { this.at = t; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  };
  const pcm = Buffer.alloc(4800); pcm.writeInt16LE(-32768, 0); pcm.writeInt16LE(16384, 2);
  voice.play(pcm.toString('base64'), 'audio/pcm;rate=24000');
  voice.play(pcm.toString('base64'), 'audio/pcm;rate=24000');
  assert.equal(buffers[0].rate, 24000); assert.equal(buffers[0].data[0], -1); assert.equal(buffers[0].data[1], .5);
  assert.equal(sources[1].at, sources[0].at + buffers[0].duration);
  voice.interrupt();
  assert.ok(sources.every(s => s.stopped)); assert.equal(voice.sources.size, 0); assert.equal(voice.ignoreAudio, true);
  voice.stop();
});

test('ending a call while microphone permission is pending still releases granted tracks', async () => {
  const original = { window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), fetch: globalThis.fetch };
  let resolveMedia, signalRequested, stops = 0, closes = 0;
  const requested = new Promise(resolve => { signalRequested = resolve; });
  class AudioContext { resume() { return Promise.resolve(); } close() { closes++; return Promise.resolve(); } }
  globalThis.window = { AudioWorkletNode: class {}, AudioContext };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia() { signalRequested(); return new Promise(resolve => { resolveMedia = resolve; }); } } } });
  globalThis.fetch = async () => Response.json({ engine: 'gemini' });
  const voice = new LiveVoice(callbacks());
  try {
    const starting = voice.start('buyer'); await requested;
    await voice.stop();
    resolveMedia({ getTracks: () => [{ stop() { stops++; } }] });
    await starting;
    assert.equal(voice.active, false); assert.equal(stops, 1); assert.equal(closes, 1);
  } finally {
    globalThis.window = original.window; globalThis.fetch = original.fetch;
    if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator); else delete globalThis.navigator;
  }
});

test('microphone worklet resamples across input frames into 100ms PCM16 packets', async () => {
  let Processor; const packets = [];
  const code = await readFile(new URL('../public/mic-worklet.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage(packet) { packets.push(packet); } }; } },
    registerProcessor(name, cls) { assert.equal(name, 'microphone-capture'); Processor = cls; },
  });
  const processor = new Processor();
  const samples = new Float32Array(4800).fill(.25);
  for (let i = 0; i < samples.length; i += 128) processor.process([[samples.subarray(i, i + 128)]]);
  assert.equal(packets.length, 1);
  const output = new Int16Array(packets[0]);
  assert.equal(output.length, 1600); assert.ok(output.every(n => n === 8192));
});
