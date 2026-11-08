import { execFile } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from './lib/store.mjs';
import { createAssistant } from './lib/assistant.mjs';
import { attachLiveServer } from './lib/live.mjs';

const store = createStore(process.env.DATABASE_PATH || './data/uzex-demo.sqlite');
const assistant = createAssistant(store);
const sessions = new Map();
const publicRoot = resolve('public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 64000) throw Object.assign(new Error('So‘rov juda katta.'), { status: 413 }); }
  try { return JSON.parse(data); } catch { throw Object.assign(new Error('JSON formati noto‘g‘ri.'), { status: 400 }); }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const url = new URL(req.url, 'http://localhost');
  try {
    if(req.method==='GET' && url.pathname==='/healthz') return json(res,200,{ok:true});
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(publicRoot + '\\') && !path.startsWith(publicRoot + '/')) return json(res, 404, { error: 'Not found' });
      try { const file = await readFile(path); res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); return res.end(file); }
      catch { return json(res, 404, { error: 'Not found' }); }
    }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Origin not allowed' });
    let id = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('uzex_session='))?.split('=')[1];
    if (!sessions.has(id) && /^[a-f0-9-]{36}$/.test(id||'') && store.hasSession(id)) sessions.set(id, {seller:{history:[]},buyer:{history:[]},busy:false,last:Date.now()});
    if (!sessions.has(id)) {
      id = randomUUID();
      sessions.set(id, { seller: { history: [] }, buyer: { history: [] }, busy: false, last: Date.now() });
      res.setHeader('Set-Cookie', `uzex_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${(process.env.COOKIE_SECURE === '1' || (process.env.COOKIE_SECURE !== '0' && process.env.NODE_ENV === 'production')) ? '; Secure' : ''}`);
    }
    const session = sessions.get(id); session.last = Date.now();
    if (req.method === 'GET' && url.pathname === '/api/notifications') return json(res,200,store.execute('list_price_alerts',{},id,'buyer'));
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { engine: assistant.engine, model: assistant.engine === 'gemini' ? assistant.model : null, demo: true });
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (session.busy) return json(res, 429, { error: 'Oldingi so‘rov tugashini kuting.' });
    const input = await body(req);
    if (!['seller', 'buyer'].includes(input.role)) return json(res, 400, { error: 'Rol noto‘g‘ri.' });
    if (session.live && ['/api/chat', '/api/reset'].includes(url.pathname)) return json(res, 409, { error: 'Avval jonli suhbatni tugating.' });
    if (url.pathname === '/api/chat') {
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 6000) return json(res, 400, { error: 'Xabar 1–6000 belgi bo‘lishi kerak.' });
      session.busy = true;
      try { return json(res, 200, await assistant.chat(input.text.trim(), session[input.role], id, input.role)); }
      finally { session.busy = false; }
    }
    if (url.pathname === '/api/reset') { session[input.role] = { history: [] }; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/confirm' || url.pathname === '/api/cancel') {
      if (typeof input.id !== 'string') return json(res, 400, { error: 'So‘rov raqami kerak.' });
      const result = url.pathname.endsWith('confirm') ? store.confirm(input.id, id, input.role) : store.cancel(input.id, id, input.role);
      const event = [{ role: 'user', parts: [{ text: `[Server-confirmed demo action status: ${JSON.stringify(result)}]` }] }, { role: 'model', parts: [{ text: 'Demo action status noted.' }] }];
      const context = session[input.role];
      context.history.push(...event);
      if (context.turns) context.turns.push(event);
      if (session.live?.role === input.role) session.live.notifyAction(result);
      return json(res, 200, result);
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) { return json(res, e.status || 400, { error: e.name === 'TimeoutError' ? 'Gemini javobi kutilganidan uzoq davom etdi. Qayta urinib ko‘ring.' : e.message || 'So‘rov bajarilmadi.' }); }
});
const liveServer = attachLiveServer(server, store, sessions);
// Keep weekly quotes fresh for saved alerts. Seller updates are checked immediately.
let quoteRefreshRunning=false;
function refreshWeeklyQuotes() {
  if(quoteRefreshRunning)return;
  quoteRefreshRunning=true;
  execFile(process.env.PYTHON_BIN||'python',['scripts/import-quotes.py'],{timeout:300000,maxBuffer:1024*1024},error=>{
    quoteRefreshRunning=false;
    if(error){console.error('Weekly quote refresh failed; retaining last snapshot:',error.message);return;}
    try {store.refreshQuotes();}catch(e){console.error('Weekly quote database refresh failed:',e.message);}
  });
}
if(process.env.QUOTE_AUTO_REFRESH!=='0') {
  setInterval(refreshWeeklyQuotes,6*60*60*1000).unref();
  setTimeout(refreshWeeklyQuotes,10000).unref();
}
setInterval(() => { try { store.evaluateAlerts(); } catch(e) { console.error('Price alert evaluation failed:',e.message); } },60000).unref();
// Browser sessions and conversation contexts expire after 24 hours.
setInterval(() => { for (const [id, s] of sessions) if (!s.busy && Date.now() - s.last > 86400000) sessions.delete(id); }, 3600000).unref();
server.listen(Number(process.env.PORT) || 3000, process.env.HOST || '127.0.0.1', () => console.log(`UZEX Assist: http://localhost:${Number(process.env.PORT) || 3000} · ${assistant.engine} · simulated operations only`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const client of liveServer.clients) client.terminate();
  server.close(() => { store.close(); process.exit(0); });
});

