export class VoiceWorkspace {
  constructor(root, { renderCard, renderMarkdown, mirrorMessage }) {
    this.root = root;
    this.renderCard = renderCard; this.renderMarkdown = renderMarkdown; this.mirrorMessage = mirrorMessage;
    this.transcripts = root.querySelector('#liveTranscriptList');
    this.pane = root.querySelector('#liveCards');
    this.emptyCards = this.pane.innerHTML;
    this.emptyTranscript = this.transcripts.innerHTML;
    this.cards = new Map(); this.turns = {}; this.sequence = 0; this.reviewId = null;
  }
  reset() {
    this.cards.clear(); this.turns = {}; this.reviewId = null; this.sequence = 0;
    this.pane.innerHTML = this.emptyCards;
    this.transcripts.innerHTML = this.emptyTranscript;
    this.root.querySelector('#voiceCardCount').textContent = '0';
    this.root.querySelector('#liveTranscript').textContent = 'Gapiring. Yordamchi ovoz orqali javob beradi.';
  }
  transcript(who, text) {
    const follow = this.transcripts.scrollHeight - this.transcripts.scrollTop - this.transcripts.clientHeight < 70;
    if (!this.turns[who]?.body) {
      const previous = this.turns[who];
      this.transcripts.querySelector('.voice-transcript-empty')?.remove();
      const element = this.root.ownerDocument.createElement('article');
      element.className = `voice-transcript-row ${who}`;
      const label = this.root.ownerDocument.createElement('strong'); label.textContent = who === 'user' ? 'Siz' : 'UZEX Assist';
      const body = this.root.ownerDocument.createElement('p'); element.append(label, body);
      this.transcripts.append(element);
      this.turns[who] = { body, text: previous?.text || '', mirror: previous?.mirror || this.mirrorMessage(who, '') };
    }
    const turn = this.turns[who]; turn.text += text;
    turn.body.textContent = turn.text;
    const mirror = turn.mirror.querySelector('.message-text');
    if (who === 'assistant') mirror.innerHTML = this.renderMarkdown(turn.text);
    else mirror.textContent = turn.text;
    this.root.querySelector('#liveTranscript').textContent = `${who === 'user' ? 'Siz' : 'Yordamchi'}: ${turn.text}`;
    if (follow) this.transcripts.scrollTop = this.transcripts.scrollHeight;
    // Intentionally never scroll or rebuild the results pane for transcript deltas.
  }
  tools(result) {
    if (!this.turns.assistant) {
      // The ordinary chat remains a record of the call after the full-window view closes.
      const mirror = this.mirrorMessage('assistant', '');
      this.turns.assistant = { mirror, text: '', body: null };
    }
    // A tool can precede its spoken transcript. Create that transcript row lazily.
    const mirror = this.turns.assistant.mirror;
    for (const value of result.cards) {
      if (value.type !== 'action' && this.cards.get(this.reviewId)?.value.action?.status !== 'pending') this.reviewId = null;
      const key = value.type === 'action' ? value.action.id : value.type;
      this.cards.set(key, { value, sequence: ++this.sequence });
      if (value.type === 'action' && value.action.status === 'pending') this.reviewId = value.action.id;
      mirror.insertAdjacentHTML('beforeend', this.renderCard(value));
    }
    if (result.cards.length) this.renderCards(result.cards.some(c => c.type === 'action'));
    if (result.traces.some(t => t.status === 'error')) {
      const note = this.root.ownerDocument.createElement('p'); note.className = 'voice-tool-error';
      note.textContent = 'So‘rovni bajarib bo‘lmadi. Yordamchi bilan shartlarni aniqlashtiring.';
      this.pane.prepend(note);
    }
  }
  renderCards(focusReview = false) {
    const previousTop = this.pane.scrollTop;
    const priority = entry => entry.value.type === 'action' && entry.value.action.id === this.reviewId ? 0 : entry.value.type === 'action' && entry.value.action.status === 'pending' ? 1 : entry.value.type === 'action' ? 3 : 2;
    const entries = [...this.cards.entries()].sort((a, b) => priority(a[1]) - priority(b[1]) || b[1].sequence - a[1].sequence);
    this.pane.replaceChildren();
    for (const [key, entry] of entries) {
      const group = this.root.ownerDocument.createElement('section');
      group.className = 'voice-result-group'; group.dataset.resultKey = key;
      group.classList.toggle('reviewing', key === this.reviewId);
      group.innerHTML = this.renderCard(entry.value);
      if (entry.value.type === 'action' && entry.value.action.status === 'pending') {
        const button = this.root.ownerDocument.createElement('button'); button.type = 'button';
        button.className = 'voice-read-button'; button.dataset.review = key;
        button.textContent = 'Shartlarni tinglash va ovoz bilan tasdiqlash';
        const hint = this.root.ownerDocument.createElement('p'); hint.className = 'voice-card-instruction';
        hint.textContent = 'Yordamchi shartlarni aytgach: “Ha, tasdiqlayman” yoki “Bekor qiling” deb javob bering.';
        const target = group.querySelector('.action-buttons'); target.before(button, hint);
      }
      this.pane.append(group);
    }
    this.root.querySelector('#voiceCardCount').textContent = String(this.cards.size);
    this.pane.scrollTop = focusReview ? 0 : previousTop;
  }
  action(result) {
    const entry = this.cards.get(result.id);
    if (!entry) return;
    entry.value.action = { ...entry.value.action, ...result };
    this.renderCards();
  }
  review(action) { this.reviewId = action.id; this.renderCards(true); }
  endTurn() { this.turns = {}; }
}
