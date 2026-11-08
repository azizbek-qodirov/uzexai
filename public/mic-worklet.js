class MicrophoneCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0; this.sum = 0; this.count = 0;
    this.chunk = new Int16Array(1600); this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample; this.count++; this.phase++;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.chunk[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.sum = 0; this.count = 0;
        if (this.offset === this.chunk.length) {
          this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
          this.chunk = new Int16Array(1600); this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('microphone-capture', MicrophoneCapture);
