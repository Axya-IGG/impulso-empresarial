import { json, erro, agora } from '../../../_lib.js';

// Descadastrar (LGPD: o titular pode pedir para parar de receber).
export async function onRequestPatch({ params, request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }
  const optout = corpo?.optout ? 1 : 0;

  const r = await env.DB.prepare(
    'UPDATE leads SET optout = ?, optout_em = ? WHERE id = ?'
  ).bind(optout, optout ? agora() : null, params.id).run();

  if (!r.meta.changes) return erro('Lead nao encontrado.', 404);
  return json({ ok: true });
}

// Excluir de vez (LGPD: direito a eliminacao). O ON DELETE CASCADE leva
// junto os envios registrados para este lead.
export async function onRequestDelete({ params, env }) {
  const r = await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(params.id).run();
  if (!r.meta.changes) return erro('Lead nao encontrado.', 404);
  return json({ ok: true });
}
