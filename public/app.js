import { renderMarkdown } from './markdown.js';
import { createVoiceInterface } from './voice-ui.js';

const $ = s => document.querySelector(s);
const icons = {
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2v-9.5A8.5 8.5 0 0 1 11.5 4H13a8 8 0 0 1 8 7.5Z"/><path d="M7 10h10M7 14h6"/>',
  chart: '<path d="M4 4v16h17M8 15l4-5 4 2 5-7"/>',
  folder: '<path d="M3 7V5h7l2 2h9v13H3Z"/><path d="M3 9h18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  bag: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  store: '<path d="M3 10 5 3h14l2 7v3a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Zm2 6v5h14v-5M10 21v-5h4v5M9 3v7m6-7v7"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
  up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  compare: '<path d="M8 3v18M16 3v18M3 7h10M11 17h10"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18m-4 5h4v4h-4Z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  phone: '<path d="M4 15c4-4 12-4 16 0l1-4c-5-5-13-5-18 0Z"/><path d="M8 12v4M16 12v4"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`; }
function hydrate(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
hydrate();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 2 }).format(n);
const toolNames = { search_lots: 'Takliflar qidirildi', market_summary: 'Bozor tahlili', account_overview: 'Hisob tekshirildi', service_directory: 'Xizmatlar topildi', prepare_listing: 'Sotuv e’loni tayyorlandi', prepare_order: 'Xarid so‘rovi tayyorlandi' };
let role = 'buyer', busy = false, recognition = null, listening = false;
const views = { buyer: { html: '' }, seller: { html: '' } };
const suggestionSets = {
  buyer: [
    ['search', 'Mahsulot topish', 'Mos takliflarni birga izlaymiz', 'Toshkentdan 20 tonna sement topib bering'],
    ['compare', 'Takliflarni solishtirish', 'Narx va shartlarni taqqoslang', 'Sement takliflarini solishtirib bering'],
    ['chart', 'Bozor bilan tanishish', 'Narxlar va mavjud takliflar', 'Bozor tahlili va narxlar'],
    ['wallet', 'Hisob va buyurtmalar', 'Operatsiyalaringizni kuzating', 'Hisobim va buyurtmalar holati'],
  ],
  seller: [
    ['store', 'Mahsulot sotish', 'Sotuv e’lonini suhbatda tayyorlang', 'Toshkentda 100 tonna M-400 sement sotaman, tonnasi 720000 so‘m'],
    ['chart', 'Narxni belgilash', 'Bozordagi narxlarni o‘rganing', 'Sement takliflari va narxlarini ko‘rsating'],
    ['folder', 'E’lonlarimni ko‘rish', 'Sotuvlaringizni kuzating', 'Hisobim va e’lonlarim holati'],
    ['grid', 'Xizmatni tanlash', 'Kerakli UZEX xizmatini toping', 'UZEX xizmatlarini ko‘rsating'],
  ],
};
function renderWelcome() {
  $('#suggestions').innerHTML = suggestionSets[role].map(([i, title, sub, prompt]) => `<button class="suggestion" data-prompt="${esc(prompt)}"><span class="suggestion-icon">${icon(i)}</span><span><strong>${title}</strong><small>${sub}</small></span><span class="suggestion-arrow">↗</span></button>`).join('');
  $('#roleBreadcrumb').textContent = role === 'buyer' ? 'Mijoz ish maydoni' : 'Sotuvchi ish maydoni';
  $('#modeIcon').innerHTML = icon(role === 'buyer' ? 'bag' : 'store');
  $('#modeTitle').textContent = role === 'buyer' ? 'Mijoz sifatida boshlang' : 'Sotuvchi sifatida boshlang';
  $('#modeDescription').textContent = role === 'buyer' ? 'Ehtiyojingizni ayting. Qolganini birga bajaramiz.' : 'Mahsulotingizni taqdim eting. Savdoga birga tayyorlaymiz.';
  $('#welcomeDescription').textContent = role === 'buyer' ? 'Mahsulot topishdan buyurtmani tasdiqlashgacha — barchasini ovoz orqali bajaring.' : 'Mahsulotingizni tanishtiring, narxlarni ko‘ring va sotuv e’lonini ovoz orqali tasdiqlang.';
  $('#messageInput').placeholder = role === 'buyer' ? 'Masalan, Toshkentdan 20 tonna sement topib bering...' : 'Masalan, 100 tonna sement sotaman, tonnasi 720000 so‘m...';
}
function notice(text = '') {
  for (const el of [$('#notice'), $('#liveNotice')]) { el.hidden = !text; el.textContent = text; }
}
async function api(path, data) {
  const res = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, role }), signal: AbortSignal.timeout(290000) });
  const result = await res.json(); if (!res.ok) throw new Error(result.error || 'So‘rov bajarilmadi.'); return result;
}
function scrollDown() { $('#conversation').scrollTo({ top: $('#conversation').scrollHeight, behavior: 'smooth' }); }
function message(who, text) {
  $('#welcome').hidden = true;
  const el = document.createElement('article'); el.className = `message ${who}`;
  el.innerHTML = `<div class="message-label">${who === 'assistant' ? icon('spark') : ''}${who === 'assistant' ? 'UZEX Assist' : 'Siz'}</div><div class="message-text"></div>`;
  const content = el.querySelector('.message-text');
  if (who === 'assistant') content.innerHTML = renderMarkdown(text);
  else content.textContent = text;
  $('#messages').append(el); scrollDown(); return el;
}
function lotsCard(lots) {
  if (!lots.length) return '<p class="action-disclaimer">Mos taklif yo‘q.</p>';
  return `<div class="lot-grid">${lots.map(l => `<div class="lot-card"><div class="lot-top"><span>${esc(l.id)}</span><span class="demo-label">TAKLIF</span></div><h3>${esc(l.name)}</h3><div class="seller">${esc(l.seller)}</div><div class="lot-price">${fmt(l.price)} <small>so‘m / tonna</small></div><div class="lot-meta"><span>⌖ ${esc(l.region)}</span><span>· ${fmt(l.quantity)} tonna</span><span>· ${esc(l.delivery)}</span></div>${role === 'buyer' ? `<button class="lot-select" data-select="${esc(l.id)}">Xaridni tayyorlash <span>↗</span></button>` : ''}</div>`).join('')}</div>`;
}
function actionCard(a) {
  const pending = a.status === 'pending';
  const label = pending ? 'TASDIQ KUTILMOQDA' : a.status === 'confirmed' ? 'TASDIQLANDI' : 'BEKOR QILINDI';
  return `<div class="action-card" data-action-id="${esc(a.id)}" data-kind="${esc(a.kind)}"><div class="action-heading"><span>${a.kind === 'order' ? 'Xarid so‘rovi' : 'Sotuv e’loni'}</span><span class="demo-label">${label}</span></div><h3>${esc(a.name)}</h3>${a.lot_id ? `<div class="action-detail"><span>Lot raqami</span><strong>${esc(a.lot_id)}</strong></div>` : ''}<div class="action-detail"><span>Hudud</span><strong>${esc(a.region)}</strong></div><div class="action-detail"><span>Hajm</span><strong>${fmt(a.quantity)} tonna</strong></div><div class="action-detail"><span>Bir tonna narxi</span><strong>${fmt(a.price)} so‘m</strong></div><div class="action-total"><span>Jami qiymat</span><strong>${fmt(a.total)} <small>so‘m</small></strong></div><p class="action-disclaimer">Transport, soliqlar va komissiyalar kiritilmagan.</p>${pending ? `<div class="action-buttons"><button class="primary-button" data-confirm="${esc(a.id)}">So‘rovni tasdiqlash</button><button class="secondary-button" data-cancel="${esc(a.id)}">Bekor qilish</button></div>` : ''}<div class="action-result" role="status">${pending ? '' : outcomeMessage(a)}</div></div>`;
}
function outcomeMessage(a) { return a.status === 'confirmed' ? a.kind === 'order' ? '✓ Buyurtmangiz muvaffaqiyatli yaratildi.' : '✓ Sotuv e’loningiz joylashtirildi.' : 'So‘rov bekor qilindi.'; }
function applyActionStatus(a) {
  liveWorkspace.action(a);
  document.querySelectorAll('[data-action-id]').forEach(el => {
    if (el.dataset.actionId !== a.id) return;
    el.querySelector('.action-buttons')?.remove(); el.querySelector('.voice-read-button')?.remove(); el.querySelector('.voice-card-instruction')?.remove();
    el.querySelector('.demo-label').textContent = a.status === 'confirmed' ? 'TASDIQLANDI' : 'BEKOR QILINDI';
    el.querySelector('.action-result').textContent = outcomeMessage({ ...a, kind: a.kind || el.dataset.kind });
  });
}
function card(c) {
  if (c.type === 'lots') return lotsCard(c.lots);
  if (c.type === 'action') return actionCard(c.action);
  if (c.type === 'services') return c.services.map(s => `<a class="service-card" href="${esc(s.url)}" target="_blank" rel="noopener"><strong>${esc(s.name)} <span>↗</span></strong><p>${esc(s.description)}</p></a>`).join('');
  if (c.type === 'account' && !c.error) return `<div class="account-card"><span>HISOB BALANSI</span><strong>${fmt(c.balance)} so‘m</strong><div class="record">${c.orders.length} ta xarid · ${c.listings.length} ta sotuv e’loni</div>${c.orders.map(o => `<div class="record">Xarid · ${esc(o.lot_id)} · ${fmt(o.quantity)} tonna · ${fmt(o.total)} so‘m</div>`).join('')}${c.listings.map(l => `<div class="record">E’lon · ${esc(l.name)} · ${fmt(l.quantity)} tonna · ${fmt(l.price)} so‘m/t</div>`).join('')}</div>`;
  if (c.type === 'market') return `<div class="table-wrap"><table class="market-table"><thead><tr><th>Toifa</th><th>Takliflar</th><th>Narx oralig‘i · so‘m/t</th></tr></thead><tbody>${c.items.map(i => `<tr><td>${esc(i.category)}</td><td>${i.offers}</td><td>${fmt(i.min_price)} – ${fmt(i.max_price)}</td></tr>`).join('')}</tbody></table></div>`;
  return '';
}
function setBusy(value) {
  busy = value;
  $('#sendButton').disabled = value;
  $('#voiceButton').disabled = value || liveVoice.active;
  $('#startVoiceMain').disabled = value;
  $('#newChat').disabled = value;
  document.querySelectorAll('[data-role]').forEach(b => b.disabled = value);
  document.querySelectorAll('.action-buttons button').forEach(b => b.disabled = value);
}
async function send(text) {
  if (busy || !text.trim()) return;
  if (liveVoice.active) await liveVoice.stop();
  stopListening(); notice(); window.speechSynthesis?.cancel();
  message('user', text);
  $('#messageInput').value = ''; resizeInput();
  setBusy(true);
  const typing = document.createElement('div'); typing.className = 'typing'; typing.innerHTML = '<i></i><i></i><i></i><span>So‘rovingiz ko‘rib chiqilmoqda…</span>'; $('#messages').append(typing); scrollDown();
  try {
    const result = await api('chat', { text });
    const el = message('assistant', result.text);
    if (result.traces.length) el.insertAdjacentHTML('beforeend', `<div class="tool-traces">${result.traces.map(t => `<span class="tool-trace ${t.status === 'error' ? 'error' : ''}">${t.status === 'error' ? '!' : '✓'} ${esc(toolNames[t.name] || t.name)}</span>`).join('')}</div>`);
    el.insertAdjacentHTML('beforeend', result.cards.map(card).join(''));
  } catch (e) {
    notice(e.name === 'TimeoutError' ? 'Javob kutilganidan uzoq davom etdi. Qayta urinib ko‘ring.' : e.message);
    const failed = message('assistant', 'Xabarni bajarib bo‘lmadi. Qayta urinishingiz mumkin.');
    const retry = document.createElement('button'); retry.className = 'secondary-button'; retry.textContent = 'Qayta urinish'; retry.addEventListener('click', () => { failed.remove(); send(text); }); failed.append(retry);
  } finally { typing.remove(); setBusy(false); scrollDown(); $('#messageInput').focus(); }
}
function resizeInput() { const input = $('#messageInput'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; }
$('#messageInput').addEventListener('input', resizeInput);
$('#messageInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(e.target.value); } });
$('#chatForm').addEventListener('submit', e => { e.preventDefault(); send($('#messageInput').value); });
document.addEventListener('click', async e => {
  const review = e.target.closest('[data-review]');
  if (review && liveVoice.active) { if (!liveVoice.review(review.dataset.review)) notice('Yordamchi ulanmoqda. Biroz kuting.'); return; }
  const prompt = e.target.closest('[data-prompt]');
  if (prompt) { $('#sidebar').classList.remove('open'); return send(prompt.dataset.prompt); }
  const selected = e.target.closest('[data-select]');
  if (selected && liveVoice.active) {
    if (!liveVoice.sendText(`${selected.dataset.select} lotni tanladim. Shu lot bo‘yicha xarid so‘rovini tayyorlashga yordam bering. Zarur ma’lumotni mendan ovoz orqali so‘rang.`)) notice('Yordamchi ulanmoqda. Biroz kuting.');
    return;
  }
  if (selected && !busy) { $('#messageInput').value = `${selected.dataset.select} dan `; resizeInput(); $('#messageInput').focus(); return notice('Hajmni qo‘shing. Masalan: “LOT-1001 dan 10 tonna olaman”.'); }
  const action = e.target.closest('[data-confirm], [data-cancel]');
  if (action && !busy) {
    const id = action.dataset.confirm || action.dataset.cancel;
    const container = action.closest('.action-card'); const result = container.querySelector('.action-result');
    setBusy(true); notice();
    try {
      const outcome = await api(action.dataset.confirm ? 'confirm' : 'cancel', { id });
      applyActionStatus(outcome);
    } catch (err) { result.textContent = err.message; }
    finally { setBusy(false); }
  }
  const next = e.target.closest('[data-role]');
  if (next && !busy && next.dataset.role !== role) {
    if (liveVoice.active) await liveVoice.stop();
    stopListening(); window.speechSynthesis?.cancel(); notice();
    views[role] = { html: $('#messages').innerHTML };
    role = next.dataset.role;
    $('#messages').innerHTML = views[role].html;
    $('#welcome').hidden = !!views[role].html;
    document.querySelectorAll('[data-role]').forEach(b => b.classList.toggle('selected', b.dataset.role === role));
    $('#messageInput').value = ''; renderWelcome(); resizeInput(); scrollDown();
  }
});
$('#newChat').addEventListener('click', async () => {
  if (busy) return;
  if (liveVoice.active) await liveVoice.stop();
  stopListening(); window.speechSynthesis?.cancel();
  try { await api('reset', {}); $('#messages').innerHTML = ''; $('#welcome').hidden = false; views[role] = { html: '' }; $('#messageInput').value = ''; notice(); resizeInput(); $('#sidebar').classList.remove('open'); $('#messageInput').focus(); }
  catch (e) { notice(e.message); }
});
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function stopListening() { recognition?.stop(); listening = false; $('#voicePanel').hidden = true; $('#voiceButton').classList.remove('listening'); }
$('#voiceButton').addEventListener('click', async () => {
  if (liveVoice.active) await liveVoice.stop();
  if (listening) return stopListening();
  if (!Recognition) return notice('Bu brauzer ovozni matnga aylantirishni qo‘llamaydi. Chrome yoki Edge orqali localhost/HTTPS manzilida oching yoki matn yozing.');
  window.speechSynthesis?.cancel(); notice();
  recognition = new Recognition(); recognition.lang = 'uz-UZ'; recognition.continuous = true; recognition.interimResults = true;
  const before = $('#messageInput').value.trim();
  recognition.onresult = event => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript + ' ';
    $('#messageInput').value = [before, transcript.trim()].filter(Boolean).join(' ');
    $('#voiceTranscript').textContent = transcript || 'Tinglayapman…'; resizeInput();
  };
  recognition.onerror = event => { stopListening(); notice(event.error === 'not-allowed' ? 'Mikrofonga ruxsat berilmadi. Brauzer sozlamalarida mikrofon ruxsatini yoqing.' : event.error === 'language-not-supported' ? 'Brauzeringiz o‘zbekcha ovoz kiritishni qo‘llamaydi. Matn orqali davom eting.' : 'Ovozni aniqlash tugadi yoki xizmat mavjud emas. Matnni tekshiring yoki qayta urinib ko‘ring.'); };
  recognition.onend = () => { stopListening(); $('#messageInput').focus(); };
  try { recognition.start(); listening = true; $('#voicePanel').hidden = false; $('#voiceTranscript').textContent = 'So‘rovingizni ayting. Matn yuborishdan oldin tekshiriladi.'; $('#voiceButton').classList.add('listening'); }
  catch { stopListening(); notice('Ovoz kiritishni ishga tushirib bo‘lmadi.'); }
});
$('#stopVoice').addEventListener('click', stopListening);
const { liveVoice, liveWorkspace } = createVoiceInterface({
  getRole: () => role, isBusy: () => busy,
  beforeStart: () => { stopListening(); window.speechSynthesis?.cancel(); notice(); },
  renderCard: card, renderMarkdown, mirrorMessage: message, onAction: applyActionStatus, notice,
});
$('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
document.addEventListener('click', e => { if (!e.target.closest('#sidebar') && !e.target.closest('#menuButton')) $('#sidebar').classList.remove('open'); });
function openInfo(about) {
  $('#dialogTitle').textContent = about ? 'UZEX Assist haqida' : 'Yordamchi qoidalari';
  $('#dialogContent').innerHTML = about ? '<p>UZEX xizmatlarini bitta suhbat orqali boshqarish g‘oyasining hackathon prototipi. Sotuvchi va Mijoz rejimlari, matn, diktovka va jonli ovozli suhbat bilan ishlaydi.</p><p>Inventar, narxlar, balans va operatsiyalar sun’iy ma’lumotlar. Tashqi portallar faqat havola orqali ochiladi. Rasmiy UZEX tizimlariga ulanmagan.</p><p>Diktovka brauzerning nutqni aniqlash xizmatidan foydalanadi. Jonli suhbatda mikrofon ovozi Gemini Live orqali Googlega uzatiladi. Mikrofon faqat jonli suhbat yoki diktovka yoqilganda ishlaydi; suhbatni tugatish uni o‘chiradi. Maxfiy ma’lumot kiritmang.</p>' : '<ul><li>Bazadan mahsulotlar, narxlar va hisob ma’lumotlarini topadi.</li><li>Sotuvchi uchun e’lon, Mijoz uchun xarid so‘rovini tayyorlaydi.</li><li>Operatsiya faqat kartada tasdiqlaganingizdan keyin bajariladi.</li><li>Haqiqiy savdo, to‘lov yoki tashqi hisob o‘zgarishi bajarilmaydi.</li><li>Parol, karta ma’lumoti yoki maxfiy kalit so‘ramaydi.</li></ul>';
  $('#infoDialog').showModal();
}
$('#rulesButton').addEventListener('click', () => openInfo(false));
$('#closeDialog').addEventListener('click', () => $('#infoDialog').close());
$('#dialogDone').addEventListener('click', () => $('#infoDialog').close());
$('#infoDialog').addEventListener('click', e => { if (e.target === $('#infoDialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
renderWelcome();
