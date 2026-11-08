import { declarations, systemInstruction } from './instructions.mjs';

const money = n => new Intl.NumberFormat('uz-UZ').format(n);
export function createAssistant(store, env = process.env) {
  const key = env.GEMINI_API_KEY;
  const live = env.AI_MODE !== 'demo' && key && !/replace_|your_|placeholder/i.test(key);
  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  async function chat(text, context, session, role) {
    const traces = [], cards = [];
    const run = (name, args = {}) => {
      let result;
      try { result = store.execute(name, args, session, role); }
      catch (e) { result = { error: e.message }; }
      traces.push({ name, status: result.error ? 'error' : 'complete' });
      if (result.quotes || result.type === 'essentials') cards.push(result);
      if (result.lots) cards.push({ type: 'lots', lots: result.lots });
      if (result.action) cards.push({ type: 'action', action: result.action });
      if (result.services) cards.push({ type: 'services', services: result.services });
      if (name === 'account_overview') cards.push({ type: 'account', ...result });
      if (name === 'market_summary') cards.push({ type: 'market', ...result });
      return result;
    };
    if (!live) {
      const reply = demo(text, context, role, run);
      context.history.push({ role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: reply }] });
      context.history = context.history.slice(-24);
      return { text: reply, cards, traces, engine: 'demo' };
    }
    const contents = [...context.history, { role: 'user', parts: [{ text }] }];
    for (let step = 0; step < 6; step++) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: systemInstruction(role) }] }, contents, tools: [{ functionDeclarations: declarations.filter(d => role === 'seller' ? d.name !== 'prepare_order' : d.name !== 'prepare_listing') }], generationConfig: { temperature: 0.3, maxOutputTokens: 2200 } }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) {
        // Do not return upstream body: provider errors can contain request details.
        const e = new Error(response.status === 429 ? 'Gemini so‘rov limiti tugadi. Biroz kutib qayta urinib ko‘ring.' : response.status === 400 || response.status === 403 ? 'Gemini kaliti yoki model sozlamalarini .env faylida tekshiring.' : 'Gemini bilan ulanish amalga oshmadi. Qayta urinib ko‘ring.');
        e.status = 502; throw e;
      }
      const body = await response.json();
      const content = body.candidates?.[0]?.content;
      if (!content?.parts?.length) throw new Error('Gemini javob qaytarmadi. So‘rovni qayta yozing.');
      contents.push(content);
      const calls = content.parts.filter(p => p.functionCall);
      if (calls.length) {
        const responses = calls.map(p => {
          const call = p.functionCall;
          const result = run(call.name, call.args || {});
          return { functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: result } };
        });
        contents.push({ role: 'user', parts: responses });
        continue;
      }
      const reply = content.parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n');
      if (!reply.trim()) throw new Error('Javob bo‘sh. Iltimos, qayta urinib ko‘ring.');
      // Keep whole turns so function call/response pairs are never split.
      context.turns = [...(context.turns || []), contents.slice(context.history.length)].slice(-6);
      context.history = context.turns.flat();
      return { text: reply, cards, traces, engine: 'gemini' };
    }
    throw new Error('So‘rov juda ko‘p bosqich talab qildi. Iltimos, vazifani aniqlashtiring.');
  }
  return { chat, engine: live ? 'gemini' : 'demo', model };
}

function demo(text, context, role, run) {
  const t = text.toLowerCase().replace(/[’‘`]/g, "'");
  if (/balans|hisob|buyurtmalar|e'lonlar|holat|status|orders/.test(t)) {
    const a = run('account_overview');
    return `Hisobingiz: ${money(a.balance)} so‘m. Tasdiqlangan xaridlar: ${a.orders.length}, sotuv e’lonlari: ${a.listings.length}.`;
  }
  if (/xizmat|logistik|davlat|portal|tender/.test(t)) { run('service_directory'); return 'UZEX xizmatlarini quyida ko‘rishingiz mumkin. Ushbu MVP tashqi portallarda operatsiya bajarmaydi; havolalar rasmiy xizmatlarga olib boradi.'; }

  if (/bekor|cancel/.test(t)) { context.draft = null; return 'Joriy suhbat qoralamasi tozalandi. Tayyorlangan so‘rovni bekor qilish uchun uning kartasidagi “Bekor qilish” tugmasini bosing.'; }
  const product = /sement|cement|цемент/.test(t) ? 'sement' : /bug|wheat|пшениц/.test(t) ? 'bug' : /paxta|cotton/.test(t) ? 'paxta' : /karbamid|urea/.test(t) ? 'karbamid' : /shakar|sugar/.test(t) ? 'shakar' : /\bmis\b|copper/.test(t) ? 'mis' : /g.?isht|brick|кирпич/.test(t) ? "g'isht" : /armatura|rebar/.test(t) ? 'armatura' : /\bun\b|uni|flour/.test(t) ? 'uni' : /ko.?mir|coal/.test(t) ? "ko'mir" : /selitra/.test(t) ? 'selitra' : /dizel|diesel/.test(t) ? 'dizel' : /polietilen/.test(t) ? 'polietilen' : null;
  if (/asosiy|muhim|katalog|mahsulotlar|important|catalog/.test(t)) { run('essential_products'); return 'Asosiy mahsulotlar va haftalik narxlar. G‘isht uchun manbada narx mavjud emas.'; }
  if (/bozor|tahlil|kotirovka|narx|haftalik/.test(t)) {
    const query = product || t.replace(/narx\w*|haftalik|kotirovka\w*|ko.rsat\w*|bering|bozor|tahlil\w*/g, '').trim();
    const result = run('market_quotes', { query });
    return `${result.total} ta haftalik kotirovka. Jadvalda mahsulot, narx, o‘zgarish va qatorning sanasi ko‘rsatilgan. Bu jonli taklif emas. Birlik va valyuta ko‘rsatilmagan bo‘lsa, manbadan tekshiring.`;
  }
  if (product === "g'isht") { run('market_quotes', {query: product}); return 'G‘isht ushbu UZEX haftalik manbasida topilmadi. Ishonchli narx va dona bo‘yicha hajm kerak; tizimdagi tonna asosidagi xaridga qo‘shilmadi.'; }
  const quantityMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(?:tonna|ton|t\b)/);
  const quantity = quantityMatch ? Number(quantityMatch[1].replace(',', '.')) : undefined;
  const region = ['Toshkent', 'Navoiy', 'Samarqand', 'Buxoro', 'Farg‘ona', 'Xorazm'].find(r => t.includes(r.toLowerCase().replace(/[’‘]/g, "'")) || t.includes(r.toLowerCase().replace(/[’‘]/g, '')));
  if (role === 'seller' && (/sot|joylashtir|e'lon|sell/.test(t) || context.draft)) {
    const d = context.draft || {};
    if (product) d.name = product === 'sement' ? `Portlandsement ${/500/.test(t) ? 'M-500' : 'M-400'}` : { bug: 'Bug‘doy, 3-sinf', paxta: 'Paxta tolasi', mis: 'Mis katodi', karbamid: 'Karbamid', shakar: 'Shakar', armatura:'Armatura', uni:'Bug‘doy uni', "ko'mir":'Ko‘mir', selitra:'Ammiakli selitra', dizel:'Dizel yoqilg‘isi', polietilen:'Polietilen' }[product];
    if (quantity) d.quantity = quantity;
    if (region) d.region = region;
    const priceMatch = t.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(ming|million|mln)?\s*(?:so'm|som|uzs)/);
    if (priceMatch) d.price = Number(priceMatch[1].replace(/\s/g, '').replace(',', '.')) * (/ming/.test(priceMatch[2] || '') ? 1000 : /million|mln/.test(priceMatch[2] || '') ? 1e6 : 1);
    context.draft = d;
    const missing = [!d.name && 'mahsulot nomi', !d.quantity && 'hajmi (tonna)', !d.price && 'bir tonna narxi (so‘m)', !d.region && 'hudud'].filter(Boolean);
    if (missing.length) return `Sotuv e’lonini tayyorlayman. Quyidagi ma’lumotlar kerak: ${missing.join(', ')}.\nMasalan: “100 tonna M-400 sement, tonnasi 720000 so‘m, Toshkent”.`;
    const result = run('prepare_listing', d);
    if (result.error) return result.error;
    context.draft = null;
    return 'Sotuv e’loni tayyorlandi. Hajm, narx va hududni kartada tekshiring. “Tasdiqlash” tugmasi orqali e’lonni joylashtiring.';
  }
  if (role === 'buyer' && (/LOT-\d+/i.test(text) || /tanla|xarid|sotib|buy|olaman/.test(t) && context.lastLots?.length && !product)) {
    const id = text.match(/LOT-\d+/i)?.[0]?.toUpperCase() || context.lastLots?.[0]?.id;
    const qty = quantity || context.quantity;
    if (!id || !qty) return 'Xarid uchun lot raqami va hajmini yozing. Masalan: “LOT-1001 dan 10 tonna olaman”.';
    const result = run('prepare_order', { lot_id: id, quantity: qty });
    return result.error || 'Xarid so‘rovi tayyorlandi. Kartadagi shartlarni tekshirib, tasdiqlang. Jami summaga transport, soliqlar va komissiyalar kiritilmagan.';
  }
  if (product || /taklif|mahsulot|qidir|izla|lot|search/.test(t)) {
    const result = run('search_lots', { query: product || '', region, quantity });
    run('market_quotes', { query: product || '' });
    context.lastLots = result.lots; context.quantity = quantity;
    return result.lots.length ? `${result.lots.length} ta taklif topildi. Narxlar bir tonna uchun ko‘rsatilgan.${role === 'buyer' ? ' Xarid so‘rovini tayyorlash uchun taklifni tanlang va hajmni yozing.' : ' Ushbu narxlarni sotuv e’loningiz uchun taqqoslashingiz mumkin.'} Bu real vaqt bozor ma’lumotlari emas.` : 'Bu shartlarga mos taklif topilmadi. Boshqa hudud yoki mahsulot bilan qidiring.';
  }
  if (/tasdiq|confirm/.test(t)) return 'Tasdiqlash uchun tayyorlangan so‘rov kartasidagi “Tasdiqlash” tugmasini bosing. Suhbatdagi matn operatsiyani bajarmaydi.';
  return role === 'seller' ? 'Sizga mahsulotni sotuvga tayyorlash, takliflarni taqqoslash va e’lonlarni kuzatishda yordam beraman. Qaysi mahsulotni, qancha hajmda sotmoqchisiz?\nKalitsiz demo rejimi cheklangan namunaviy buyruqlarni tushunadi. Erkin suhbat uchun .env fayliga Gemini kalitini kiriting.' : 'Qaysi mahsulotni qidiryapsiz? Mahsulot nomi, kerakli hajm va hududni ayting. Masalan: “Toshkentdan 20 tonna sement kerak”.\nKalitsiz demo rejimi cheklangan namunaviy buyruqlarni tushunadi. Erkin suhbat uchun .env fayliga Gemini kalitini kiriting.';
}

