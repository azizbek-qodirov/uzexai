import { normalize } from './quotes.mjs';
import { productGroup } from './analytics.mjs';
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
      if (result.quotes || ['essentials','analytics','alert','notifications'].includes(result.type)) cards.push(result);
      if (result.lots) cards.push({ ...result, type: 'lots' });
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
  const t=normalize(text);
  const group=productGroup(t);
  const product=group?.key || (/wheat/.test(t)?"bug'doy":/sugar/.test(t)?'shakar':/cement/.test(t)?'sement':null);
  const quantityMatch=t.match(/(\d+(?:[.,]\d+)?)\s*(tonna|tons?|tonnes?|kg|kilogram)/);
  const quantity=quantityMatch?Number(quantityMatch[1].replace(',','.'))/(quantityMatch[2]==='kg'||quantityMatch[2]==='kilogram'?1000:1):undefined;
  const region=['Toshkent','Navoiy','Samarqand','Buxoro','Farg‘ona','Xorazm'].find(r=>t.includes(normalize(r))) || (/tashkent/.test(t)?'Toshkent':undefined);
  if(/kuzatuv.*bekor|cancel.*alert/.test(t)){const id=text.match(/[a-f0-9]{8}-[a-f0-9-]{27}/i)?.[0];if(!id)return 'Bekor qilish uchun kuzatuv ID si kerak.';const r=run('cancel_price_alert',{id});return r.error||r.note;}
  if(/kuzatuvlar|ogohlantirishlar|alerts|notifications/.test(t)){run('list_price_alerts');return 'Saqlangan kuzatuvlar va ogohlantirishlar.';}
  if(/ogohlantir|xabar ber|warn|notify|alert me/.test(t)) {
    if(!product)return 'Qaysi mahsulot narxini kuzatay?';
    const target=t.match(/(?:past|below|under|maqsad)\s*(\d+(?:[.,]\d+)?)/);
    const r=run('create_price_alert',{query:product,quantity:quantity||1,region,...(target?{target_price:Number(target[1].replace(',','.'))}: {})});
    return r.error || `Kuzatuv saqlandi: ${money(r.target)} UZS/tonna dan past yoki teng narxda. ${r.note}`;
  }
  if(/balans|hisob|e'lonlarim|buyurtmalarim|my orders|status/.test(t)){
    const a=run('account_overview');return `Hisobingiz: ${money(a.balance)} so‘m. Xaridlar: ${a.orders.length}, sotuv e’lonlari: ${a.listings.length}.`;
  }
  if(/xizmat|logistik|davlat|portal|tender/.test(t)){run('service_directory');return 'Rasmiy xizmat havolalari.';}
  if(/bekor|cancel/.test(t)){context.draft=null;return 'Qoralama tozalandi. Tayyor so‘rovni uning kartasidan bekor qiling.';}
  if(/asosiy|muhim|katalog|mahsulotlar|important|catalog/.test(t)){run('essential_products');return 'Asosiy mahsulotlar katalogi.';}
  const analytics=/bozor|tahlil|anal|narx|price|average|o'rtacha|hafta|qachon|when.*buy/.test(t);
  const selling=role==='seller' && (/sotaman|joylashtir|sell|e'lon tayyor/.test(t)||context.draft);
  // Advice questions never silently prepare a listing.
  if(analytics && (!selling || /o'rtacha|average|tahlil|anal|bozor|market/.test(t))){
    if(!product)return 'Qaysi mahsulot narxini tahlil qilay?';
    const a=run('price_analytics',{query:product,region});if(!a.available)return a.note;
    return `${a.active_market?`Ilovada ${a.active_market.count} ta sotuvchi taklifi o‘rtachasi ${money(a.active_market.average)} UZS/tonna. `:''}${a.product}: oxirgi mavjud haftalik o‘rtacha ${money(a.average)} UZS/tonna (${money(a.average_per_kg)} UZS/kg). ${a.change_percent===null?'Taqqoslash uchun ma’lumot yetarli emas.':`Taqqoslanadigan davrlar bo‘yicha ${a.change_percent.toFixed(2)}%: ${a.trend==='up'?'o‘sish':a.trend==='down'?'pasayish':'barqaror'}.`} Manba sanalari: ${a.series.at(-1).observed_dates.join(', ')}. ${a.note} Kelajakda qachon arzonlashishini kafolatlab bo‘lmaydi; narx kuzatuvini so‘rashingiz mumkin.`;
  }
  if(product==="g'isht"){run('market_quotes',{query:product});return 'G‘isht uchun narx va dona bo‘yicha hajm tasdiqlanmagan. Tonna asosida xarid qilinmaydi.';}
  if(selling){
    const d=context.draft||{};if(product)d.name=group?.name||product;if(quantity)d.quantity=quantity;if(region)d.region=region;
    const priceMatch=t.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(ming|million|mln)?\s*(?:so'm|som|uzs)/);
    if(priceMatch){d.price=Number(priceMatch[1].replace(/\s/g,'').replace(',','.'))*(priceMatch[2]==='ming'?1000:/million|mln/.test(priceMatch[2]||'')?1e6:1);d.price_unit=/kilosi|kilogrammiga|kilogramiga|kgiga|kg uchun|kilogram uchun|per kg|per kilogram|uzs\/kg|so'm\/kg/.test(t)?'kg':'tonna';}
    context.draft=d;
    const missing=[!d.name&&'mahsulot',!d.quantity&&'hajmi (tonna)',!d.price&&'birlik narxi',!d.region&&'hudud'].filter(Boolean);
    if(missing.length)return `Kerakli ma’lumotlar: ${missing.join(', ')}. Narxi kg yoki tonna uchun ekanini ko‘rsating.`;
    const r=run('prepare_listing',d);if(r.error)return r.error;context.draft=null;return 'Sotuv e’loni tayyor. Narx va shartlarni tekshirib tasdiqlang; keyin boshqa mijozlarga ko‘rinadi.';
  }
  const lotId=text.match(/LOT-(?:SELL-[a-f0-9-]+|\d+)/i)?.[0];
  if(role==='buyer' && (lotId||/tanla|xarid|sotib|buy|olaman/.test(t)&&context.lastLots?.length&&!product)){
    const id=lotId ? lotId.replace(/^lot-(sell-)?/i,(_m,s)=>s?'LOT-SELL-':'LOT-') : context.lastLots[0].id;const qty=quantity||context.quantity;
    if(!qty)return 'Xarid hajmini tonna yoki kg da ayting.';
    const r=run('prepare_order',{lot_id:id,quantity:qty});return r.error||'Xarid so‘rovi tayyor. Kartadagi shartlarni tekshirib tasdiqlang.';
  }
  if(product||/taklif|mahsulot|qidir|izla|lot|search|active orders/.test(t)){
    const r=run('search_lots',{query:product||'',region,quantity});context.lastLots=r.lots;context.quantity=quantity;
    return r.lots.length?`${r.lots.length} ta taklif topildi. ${r.region_fallback?`${region}da mos taklif yo‘q; boshqa hududlar: ${r.available_regions.join(', ')}.`:''} Narx UZS/tonna. Sotuvchi e’lonlari ham ko‘rsatilgan.`:'Bu mahsulot uchun yetarli qoldiqli taklif topilmadi.';
  }
  return 'Mahsulot qidirish, narxlarni tahlil qilish yoki narx tushishini kuzatishni so‘rashingiz mumkin.';
}
