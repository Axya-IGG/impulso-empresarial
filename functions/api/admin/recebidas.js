import { json } from '../../_lib.js';

/**
 * Caixa de entrada: mensagens que leads mandaram de volta, gravadas pelo
 * webhook (functions/api/webhook/meta-whatsapp.js). Ordem de conversa de
 * WhatsApp — mais recente primeiro — em vez de agrupar por lida/nao lida,
 * que escondia mensagem antiga ja' respondida no meio das novas.
 */
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT r.id, r.whatsapp, r.texto, r.recebido_em, r.lida,
           l.nome AS lead_nome
      FROM mensagens_recebidas r
      LEFT JOIN leads l ON l.id = r.lead_id
     ORDER BY r.recebido_em DESC
     LIMIT 300
  `).all();

  const naoLidas = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mensagens_recebidas WHERE lida = 0'
  ).first();

  return json({ recebidas: results || [], nao_lidas: naoLidas?.n ?? 0 });
}
