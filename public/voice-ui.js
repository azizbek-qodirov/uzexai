import { LiveVoice } from './live-voice.js';
import { VoiceWorkspace } from './voice-workspace.js';

export function createVoiceInterface({ getRole, isBusy, beforeStart, renderCard, renderMarkdown, mirrorMessage, onAction, notice }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#liveCall');
  const workspace = new VoiceWorkspace(dialog, { renderCard, renderMarkdown, mirrorMessage });
  let timer = null;
  const voice = new LiveVoice({
    state(state) {
      const ended = state === 'ended';
      if (ended) {
        if (dialog.open) dialog.close();
        dialog.hidden = true; document.body.classList.remove('in-voice-session');
        clearInterval(timer); timer = null;
        $('#muteLive').setAttribute('aria-pressed', 'false');
        $('#muteLive span:last-child').textContent = 'Mikrofonni o‘chirish';
      } else {
        dialog.hidden = false;
        if (!dialog.open) dialog.showModal();
        document.body.classList.add('in-voice-session');
      }
      const labels = { connecting: 'Ulanmoqda…', listening: 'Sizni tinglayapman', thinking: 'So‘rovingiz ustida ishlayapman', speaking: 'Yordamchi gapiryapti', muted: 'Mikrofon o‘chirilgan', ended: 'Suhbat tugadi' };
      $('#liveStatus').textContent = labels[state] || labels.listening;
      const orb = $('#liveOrb'); orb.dataset.state = state;
      const animation = state === 'speaking' ? 'answering' : state === 'thinking' || state === 'connecting' ? 'processing' : state === 'muted' ? 'ready' : 'listening';
      let image = orb.querySelector('img');
      if (!image) { image = document.createElement('img'); image.alt = ''; orb.replaceChildren(image); }
      const path = `/assets/voice/${animation}.gif`;
      if (image.getAttribute('src') !== path) image.setAttribute('src', path);
      orb.classList.toggle('landscape', animation === 'listening');
      $('#startVoiceMain').setAttribute('aria-pressed', String(!ended));
      $('#voiceButton').disabled = !ended;
    },
    transcript(who, text) { workspace.transcript(who, text); },
    tools(result) { workspace.tools(result); },
    action(result) { onAction(result); },
    review(action) { workspace.review(action); notice(); },
    turn() { workspace.endTurn(); },
    error(text) { notice(text); },
  });
  async function start() {
    if (isBusy()) return;
    if (voice.active) return voice.stop();
    beforeStart(); workspace.reset();
    $('#liveRoleLabel').textContent = getRole() === 'buyer' ? 'Mijoz' : 'Sotuvchi';
    $('#voiceHint').textContent = getRole() === 'buyer' ? 'Masalan: “Toshkentdan 20 tonna sement kerak”' : 'Masalan: “100 tonna sementni sotuvga joylashtirmoqchiman”';
    $('#liveClock').textContent = '00:00';
    const started = Date.now();
    timer = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); $('#liveClock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }, 1000);
    await voice.start(getRole());
  }
  $('#startVoiceMain').addEventListener('click', start);
  $('#endLive').addEventListener('click', () => voice.stop());
  $('#closeLive').addEventListener('click', () => voice.stop());
  dialog.addEventListener('cancel', event => { event.preventDefault(); voice.stop(); });
  dialog.addEventListener('close', () => { if (voice.active) voice.stop(); });
  $('#muteLive').addEventListener('click', () => {
    const muted = voice.mute();
    $('#muteLive').setAttribute('aria-pressed', String(muted));
    $('#muteLive span:last-child').textContent = muted ? 'Mikrofonni yoqish' : 'Mikrofonni o‘chirish';
  });
  $('#interruptLive').addEventListener('click', () => voice.interrupt());
  $('#toggleTranscripts').addEventListener('click', () => {
    const show = $('#voiceTranscripts').hidden;
    $('#voiceTranscripts').hidden = !show;
    $('#toggleTranscripts').setAttribute('aria-pressed', String(show));
    dialog.classList.toggle('transcripts-hidden', !show);
  });
  // Keep the floating launcher above the composer as text input and notices grow.
  const composer = $('.composer-area');
  const positionLauncher = () => {
    const bounds = $('.composer').getBoundingClientRect();
    // Align with the actual input border, even when its centered container is narrower than the window.
    document.documentElement.style.setProperty('--voice-dock-right', `${Math.max(16, window.innerWidth - bounds.right)}px`);
    document.documentElement.style.setProperty('--voice-dock-bottom', `${Math.max(16, window.innerHeight - bounds.top + 12)}px`);
  };
  positionLauncher();
  if (window.ResizeObserver) new window.ResizeObserver(positionLauncher).observe(composer);
  window.addEventListener('resize', positionLauncher);
  window.addEventListener('pagehide', () => { if (voice.active) voice.stop(); });
  return { liveVoice: voice, liveWorkspace: workspace };
}
