import WebSocket, { WebSocketServer } from 'ws';
import { declarations, systemInstruction } from './instructions.mjs';
import { createVoiceActions, voiceActionTool } from './voice-actions.mjs';

export function liveSetup(role, env = process.env) {
  return {
    setup: {
      model: `models/${env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview'}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_LIVE_VOICE || 'Kore' } } } },
      systemInstruction: { parts: [{ text: systemInstruction(role, true) + '\nYou are in a full-window live voice conversation. Listen and reply naturally in Uzbek unless the user chooses another language. Keep spoken turns brief, usually one to three sentences. Ask one question at a time. Do not read tables, Markdown, UUIDs or long lists aloud. Use tools to show offer/confirmation cards in the separate workspace, which stays visible while transcripts scroll independently. The user can interrupt your speech. After preparing a transaction, briefly read its product, quantity, unit price and total, then ask “Tasdiqlaysizmi? Ha, tasdiqlayman yoki bekor qiling deb ayting.” On a fresh explicit spoken confirmation/cancellation call resolve_action with its exact action_id. If the server rejects ambiguous consent, clarify instead of retrying. Never confirm based on the original product request, silence, background audio or a previous confirmation. A server application status or successful resolve_action result is authoritative. Only say an operation succeeded after receiving that result.' }] },
      tools: [{ functionDeclarations: [...declarations.filter(d => role === 'seller' ? d.name !== 'prepare_order' : d.name !== 'prepare_listing'), voiceActionTool] }],
      inputAudioTranscription: {}, outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 150, silenceDurationMs: 650 } },
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

export function attachLiveServer(server, store, sessions, env = process.env, upstreamUrl) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 48000 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role');
    const id = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('uzex_session='))?.split('=')[1];
    const session = sessions.get(id);
    const originOk = !req.headers.origin || [`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin);
    if (url.pathname !== '/api/live' || !originOk || !session || !['seller', 'buyer'].includes(role)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, client => {
      const send = data => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data)); };
      if (session.live || session.busy) { send({ type: 'error', message: 'Boshqa suhbat hali tugamagan.' }); client.close(); return; }
      const key = env.GEMINI_API_KEY;
      if (!key || /replace_|your_|placeholder/i.test(key) || env.AI_MODE === 'demo') {
        send({ type: 'error', message: 'Jonli suhbat uchun .env faylida GEMINI_API_KEY ni sozlang va serverni qayta ishga tushiring.' }); client.close(); return;
      }
      let ready = false, closed = false, userText = '', assistantText = '';
      const upstream = new WebSocket(upstreamUrl || `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`, { maxPayload: 4 * 1024 * 1024, handshakeTimeout: 15000 });
      const upstreamSend = data => { if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(data)); };
      const voiceActions = createVoiceActions(store, id, role, action => send({ type: 'action', action }));
      const flush = () => {
        if (!userText.trim() && !assistantText.trim()) return;
        const turn = [
          ...(userText.trim() ? [{ role: 'user', parts: [{ text: userText.trim() }] }] : []),
          ...(assistantText.trim() ? [{ role: 'model', parts: [{ text: assistantText.trim() }] }] : []),
        ];
        const context = session[role];
        context.turns = [...(context.turns || (context.history.length ? [context.history] : [])), turn].slice(-6);
        context.history = context.turns.flat();
        userText = ''; assistantText = '';
      };
      const setupTimeout = setTimeout(() => { send({ type: 'error', message: 'Ovozli xizmatga ulanish vaqti tugadi. Live model va API sozlamalarini tekshiring.' }); client.close(); }, 20000);
      const lifetime = setTimeout(() => { send({ type: 'error', message: 'Suhbat muddati tugadi. Yangi jonli suhbat boshlashingiz mumkin.' }); client.close(); }, 15 * 60 * 1000);
      const cleanup = () => {
        if (closed) return; closed = true;
        clearTimeout(setupTimeout); clearTimeout(lifetime); flush();
        if (session.live?.client === client) delete session.live;
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
        else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      };
      session.live = {
        client, role,
        notifyAction(result) {
          voiceActions.complete(result);
          if (ready) upstreamSend({ clientContent: { turns: [{ role: 'user', parts: [{ text: `[Application status: ${JSON.stringify(result)}]. Briefly tell me the outcome in Uzbek.` }] }], turnComplete: true } });
        },
      };
      upstream.on('open', () => upstreamSend(liveSetup(role, env)));
      upstream.on('message', raw => {
        if (closed) return;
        try {
          const event = JSON.parse(raw.toString());
          if (event.error) { send({ type: 'error', message: 'Gemini Live so‘rovni qabul qilmadi. Live model, API ruxsatlari va kvotani tekshiring.' }); client.close(); return; }
          if (event.setupComplete) {
            ready = true; clearTimeout(setupTimeout);
            // Seed conversational context, never replay tools or accept client-supplied instructions.
            const history = session[role].history.map(c => ({ role: c.role, parts: c.parts.filter(p => p.text && !p.thought).map(p => ({ text: p.text })) })).filter(c => c.parts.length).slice(-12);
            if (history.length) upstreamSend({ clientContent: { turns: history, turnComplete: false } });
            send({ type: 'ready' });
          }
          const content = event.serverContent;
          if (content?.interrupted) { flush(); voiceActions.endTurn(); send({ type: 'interrupted' }); }
          // Consent must be available even when a transcript and tool call share a frame.
          if (content?.inputTranscription?.text) { userText += content.inputTranscription.text; voiceActions.input(content.inputTranscription.text); send({ type: 'transcript', who: 'user', text: content.inputTranscription.text }); }
          if (event.toolCall?.functionCalls) {
            const responses = [];
            for (const call of event.toolCall.functionCalls.slice(0, 8)) {
              let result;
              try { result = call.name === 'resolve_action' ? voiceActions.resolve(call.args || {}) : store.execute(call.name, call.args || {}, id, role); }
              catch (e) { result = { error: e.message }; }
              responses.push({ id: call.id, name: call.name, response: result });
              const cards = [];
              if (result.lots) cards.push({ type: 'lots', lots: result.lots });
              if (result.action) { voiceActions.present(result.action); cards.push({ type: 'action', action: result.action }); }
              if (result.services) cards.push({ type: 'services', services: result.services });
              if (call.name === 'account_overview' && !result.error) cards.push({ type: 'account', ...result });
              if (call.name === 'market_summary' && !result.error) cards.push({ type: 'market', ...result });
              send({ type: 'tools', cards, traces: [{ name: call.name, status: result.error ? 'error' : 'complete' }] });
            }
            upstreamSend({ toolResponse: { functionResponses: responses } });
          }
          if (content) {
            if (content.outputTranscription?.text) { assistantText += content.outputTranscription.text; send({ type: 'transcript', who: 'assistant', text: content.outputTranscription.text }); }
            for (const part of content.modelTurn?.parts || []) {
              if (part.inlineData?.mimeType?.startsWith('audio/pcm')) send({ type: 'audio', data: part.inlineData.data, mimeType: part.inlineData.mimeType });
            }
            if (content.turnComplete) { flush(); voiceActions.endTurn(); send({ type: 'turnComplete' }); }
          }
          if (event.goAway) { send({ type: 'error', message: 'Ovozli sessiya yakunlanmoqda. Qayta ulaning.' }); client.close(); }
        } catch { send({ type: 'error', message: 'Ovozli xizmat javobini o‘qib bo‘lmadi.' }); client.close(); }
      });
      client.on('message', raw => {
        if (!ready || closed) return;
        session.last = Date.now();
        try {
          const data = JSON.parse(raw.toString());
          if (data.type === 'audio' && typeof data.data === 'string' && data.data.length <= 32000 && /^[A-Za-z0-9+/]*={0,2}$/.test(data.data)) {
            if (upstream.bufferedAmount > 512000) return;
            upstreamSend({ realtimeInput: { audio: { data: data.data, mimeType: 'audio/pcm;rate=16000' } } });
          } else if (data.type === 'mute') upstreamSend({ realtimeInput: { audioStreamEnd: true } });
          else if (data.type === 'text' && typeof data.text === 'string' && data.text.trim().length > 0 && data.text.length <= 6000) {
            voiceActions.endTurn();
            userText += data.text;
            send({ type: 'transcript', who: 'user', text: data.text });
            upstreamSend({ clientContent: { turns: [{ role: 'user', parts: [{ text: data.text }] }], turnComplete: true } });
          } else if (data.type === 'review' && typeof data.id === 'string') {
            try {
              const action = voiceActions.review(data.id);
              send({ type: 'review', action });
              upstreamSend({ clientContent: { turns: [{ role: 'user', parts: [{ text: `[Application: user selected this card for spoken review: ${JSON.stringify(action)}]. Read the product, quantity, unit price and total briefly in Uzbek, then ask for a fresh spoken confirmation. This selection is not consent.` }] }], turnComplete: true } });
            } catch (e) { send({ type: 'reviewError', message: e.message }); }
          }
        } catch { client.close(1008, 'Invalid message'); }
      });
      upstream.on('error', () => { send({ type: 'error', message: 'Gemini Live bilan ulanish amalga oshmadi. Tarmoq va API sozlamalarini tekshiring.' }); client.close(); });
      upstream.on('close', code => {
        if (!closed) {
          send(!ready || code !== 1000 ? { type: 'error', message: 'Gemini Live sessiyasi uzildi. Live model, API ruxsatlari va kvotani tekshirib, qayta ulaning.' } : { type: 'ended' });
          client.close();
        }
      });
      client.on('close', cleanup); client.on('error', cleanup);
    });
  });
  return wss;
}
