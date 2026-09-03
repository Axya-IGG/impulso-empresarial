import { json, erro, agora } from '../../../_lib.js';

// Descadastrar (LGPD: o titular pode pedir para parar de receber) e/ou
// marcar compra manualmente. Os dois campos sao independentes — o corpo
// pode trazer um, outro, ou os dois.
export async function onRequestPatch({ params, request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  if (!('optout' in corpo) && !('comprou' in corpo)) {
    return erro('Nada para atualizar.');
  }

  const lead = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(params.id).first();
  if (!lead) return erro('Lead nao encontrado.', 404);

  if ('optout' in corpo) {
    const optout = corpo.optout ? 1 : 0;
    await env.DB.prepare(
      'UPDATE leads SET optout = ?, optout_em = ? WHERE id = ?'
    ).bind(optout, optout ? agora() : null, params.id).run();
  }

  if ('comprou' in corpo) {
    // Nunca reescreve uma linha existente (cancelada/reembolsada e' fato
    // historico real, vindo da Eduzz ou de uma correcao anterior) — so
    // insere uma nova linha manual ao ligar, e so cancela a(s) aprovada(s)
    // ao desligar. O historico completo fica sempre visivel em `compras`.
    if (corpo.comprou) {
      const aprovada = await env.DB.prepare(
        "SELECT id FROM compras WHERE lead_id = ? AND status = 'aprovada'"
      ).bind(params.id).first();
      if (!aprovada) {
        await env.DB.prepare(`
          INSERT INTO compras (lead_id, status, origem, criado_em)
          VALUES (?, 'aprovada', 'manual', ?)
        `).bind(params.id, agora()).run();
      }
    } else {
      await env.DB.prepare(
        "UPDATE compras SET status = 'cancelada' WHERE lead_id = ? AND status = 'aprovada'"
      ).bind(params.id).run();
    }
  }

  return json({ ok: true });
}

// Excluir de vez (LGPD: direito a eliminacao). O ON DELETE CASCADE leva
// junto os envios registrados para este lead.
export async function onRequestDelete({ params, env }) {
  const r = await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(params.id).run();
  if (!r.meta.changes) return erro('Lead nao encontrado.', 404);
  return json({ ok: true });
}
