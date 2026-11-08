export class LiveVoice {
  constructor(callbacks) { this.callbacks = callbacks; this.active = false; this.sources = new Set(); this.generation = 0; }
  async start(role) {
    if (this.active) return;
    this.active = true; this.muted = false; this.ignoreAudio = false;
    const generation = ++this.generation;
    this.callbacks.state('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Jonli suhbat uchun Chrome yoki Edge brauzerida localhost yoki HTTPS manzilidan foydalaning.');
      // Establish the same anonymous HTTP session used by trading tools.
      const config = await fetch('/api/config');
      if (!config.ok) throw new Error('Server bilan ulanish amalga oshmadi.');
      const settings = await config.json();
      if (settings.engine !== 'gemini') throw new Error('Jonli suhbat uchun Gemini API kalitini .env faylida sozlang va serverni qayta ishga tushiring.');
      if (!this.active || generation !== this.generation) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audio = new AudioContext(); await this.audio.resume();
      if (!this.active || generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!this.active || generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      await this.audio.audioWorklet.addModule('/mic-worklet.js');
      if (!this.active || generation !== this.generation) return;
      this.capture = new AudioWorkletNode(this.audio, 'microphone-capture');
      this.input = this.audio.createMediaStreamSource(stream);
      this.silent = this.audio.createGain(); this.silent.gain.value = 0;
      this.input.connect(this.capture); this.capture.connect(this.silent); this.silent.connect(this.audio.destination);
      this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live?role=${encodeURIComponent(role)}`);
      const socket = this.socket;
      this.capture.port.onmessage = event => {
        if (!this.active || this.muted || !this.ready || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256000) return;
        const bytes = new Uint8Array(event.data);
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        socket.send(JSON.stringify({ type: 'audio', data: btoa(binary) }));
      };
      socket.onmessage = event => {
        if (!this.active || generation !== this.generation) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ready') { this.ready = true; this.callbacks.state('listening'); }
          else if (data.type === 'audio' && !this.ignoreAudio) this.play(data.data, data.mimeType);
          else if (data.type === 'transcript') { this.callbacks.transcript(data.who, data.text); if (data.who === 'user' && !this.sources.size) this.callbacks.state('thinking'); }
          else if (data.type === 'tools') this.callbacks.tools(data);
          else if (data.type === 'action') this.callbacks.action?.(data.action);
          else if (data.type === 'review') this.callbacks.review?.(data.action);
          else if (data.type === 'reviewError') this.callbacks.error(data.message);
          else if (data.type === 'interrupted') { this.clearPlayback(); this.ignoreAudio = false; this.callbacks.turn(); this.callbacks.state('listening'); }
          else if (data.type === 'turnComplete') { this.ignoreAudio = false; this.callbacks.turn(); if (!this.sources.size) this.callbacks.state(this.muted ? 'muted' : 'listening'); }
          else if (data.type === 'error') { this.callbacks.error(data.message); this.stop(); }
          else if (data.type === 'ended') this.stop();
        } catch { this.callbacks.error('Ovozli javobni qayta ishlashda xatolik yuz berdi.'); this.stop(); }
      };
      socket.onerror = () => { if (this.active && generation === this.generation) { this.callbacks.error('Jonli suhbatga ulanib bo‘lmadi. Serverni qayta ishga tushiring va API sozlamalarini tekshiring.'); this.stop(); } };
      socket.onclose = () => { if (this.active && generation === this.generation) this.stop(); };
    } catch (e) {
      if (generation !== this.generation) return;
      this.callbacks.error(e.name === 'NotAllowedError' ? 'Mikrofonga ruxsat berilmadi. Brauzer sozlamalarida ruxsatni yoqing.' : e.message);
      this.stop();
    }
  }
  play(data, mimeType) {
    const binary = atob(data); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const rate = Number(mimeType?.match(/rate=(\d+)/)?.[1] || 24000);
    const buffer = this.audio.createBuffer(1, Math.floor(bytes.length / 2), rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.audio.createBufferSource(); source.buffer = buffer; source.connect(this.audio.destination);
    this.nextTime = Math.max(this.nextTime || 0, this.audio.currentTime + .04);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); this.sources.delete(source); if (this.active && !this.sources.size) this.callbacks.state(this.muted ? 'muted' : 'listening'); };
    source.start(this.nextTime); this.nextTime += buffer.duration;
    this.callbacks.state('speaking');
  }
  clearPlayback() {
    for (const source of this.sources) { source.onended = null; try { source.stop(); source.disconnect(); } catch {} }
    this.sources.clear(); this.nextTime = 0;
  }
  sendText(text) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.interrupt();
    this.socket.send(JSON.stringify({ type: 'text', text }));
    this.ignoreAudio = false; return true;
  }
  review(id) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.interrupt();
    this.socket.send(JSON.stringify({ type: 'review', id }));
    this.ignoreAudio = false; return true;
  }
  interrupt() { this.ignoreAudio = true; this.clearPlayback(); this.callbacks.state(this.muted ? 'muted' : 'listening'); }
  mute() {
    this.muted = !this.muted;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
    if (this.muted && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'mute' }));
    this.callbacks.state(this.muted ? 'muted' : 'listening'); return this.muted;
  }
  stop() {
    this.active = false; this.ready = false; this.generation++;
    this.clearPlayback();
    let ended = Promise.resolve();
    if (this.socket) {
      const socket = this.socket;
      ended = new Promise(resolve => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        const timer = setTimeout(resolve, 1000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      socket.onclose = null; socket.onerror = null; socket.close(); this.socket = null;
    }
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    if (this.capture) { this.capture.port.onmessage = null; this.capture.disconnect(); this.capture = null; }
    this.input?.disconnect(); this.silent?.disconnect();
    this.audio?.close().catch(() => {}); this.audio = null;
    this.callbacks.turn(); this.callbacks.state('ended');
    return ended;
  }
}
