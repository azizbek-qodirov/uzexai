export const voiceActionTool = {
  name: 'resolve_action',
  description: 'Confirm or cancel the currently reviewed transaction after an explicit, fresh spoken response. First read its product, quantity, unit price and total aloud and ask for confirmation. Use the exact action_id returned by prepare_order/prepare_listing. The server independently checks spoken consent, session, role and pending status; never infer consent from a product request.',
  parameters: { type: 'OBJECT', properties: { action_id: { type: 'STRING' }, decision: { type: 'STRING', enum: ['confirm', 'cancel'] } }, required: ['action_id', 'decision'] },
};

export function spokenDecision(text) {
  const t = String(text).toLowerCase().replace(/[’‘`ʻʼ]/g, "'").replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:ha(?: (?:buni |buyurtmani |so'rovni |e'lonni )?tasdiqlayman)?|(?:buni |buyurtmani |so'rovni |e'lonni )?tasdiqla(?:yman|ng)?|yes(?: i confirm| confirm(?: it)?)?|i confirm|confirm(?: it)?|да(?: подтверждаю)?|подтверждаю)$/u.test(t)) return 'confirm';
  if (/^(?:yo'q(?: bekor qil(?:ing)?)?|(?:buni |buyurtmani |so'rovni |e'lonni )?bekor qil(?:ing|aman)?|tasdiqlamayman|no(?: cancel(?: it)?)?|cancel(?: it)?|нет(?: отменить)?|отменить|отменяю)$/u.test(t)) return 'cancel';
  return null;
}

export function createVoiceActions(store, sessionId, role, onResult) {
  const actions = new Map();
  let activeId = null, consent = '';
  return {
    present(action) { actions.set(action.id, action); activeId = action.id; consent = ''; },
    input(text) { consent += text; },
    endTurn() { consent = ''; },
    review(id) {
      const action = actions.get(id);
      if (!action || action.status !== 'pending') throw new Error('Tasdiqlash kutilayotgan so‘rov topilmadi.');
      activeId = id; consent = ''; return action;
    },
    complete(result) {
      if (actions.has(result.id)) actions.set(result.id, { ...actions.get(result.id), ...result });
      if (activeId === result.id) { activeId = null; consent = ''; }
      onResult(result);
    },
    resolve({ action_id: id, decision }) {
      if (!activeId || id !== activeId || actions.get(id)?.status !== 'pending') throw new Error('Avval aynan shu so‘rov shartlarini ko‘rib chiqing va tasdiqlashni so‘rang.');
      if (!['confirm', 'cancel'].includes(decision) || spokenDecision(consent) !== decision) throw new Error('Aniq ovozli javob kerak: “Ha, tasdiqlayman” yoki “Bekor qiling”. Rozilikni taxmin qilmang.');
      consent = '';
      const result = decision === 'confirm' ? store.confirm(id, sessionId, role) : store.cancel(id, sessionId, role);
      this.complete(result); return result;
    },
  };
}
