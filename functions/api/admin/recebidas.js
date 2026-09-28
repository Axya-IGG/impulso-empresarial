import { json } from '../../_lib.js';

/**
 * Caixa de entrada: mensagens que leads mandaram de volta, gravadas pelos
 * dois webhooks (functions/api/webhook/evolution.js e meta-whatsapp.js).
 * `lida` decide o que aparece primeiro — quem ainda nao foi visto/respondido
 * sobe pro topo, pra nao se perder entre as ja tratadas.
 */
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT r.id, r.whatsapp, r.texto, r.canal, r.recebido_em, r.lida,
           l.nome AS lead_nome
      FROM mensagens_recebidas r
      LEFT JOIN leads l ON l.id = r.lead_id
     ORDER BY r.lida ASC, r.recebido_em DESC
     LIMIT 300
  `).all();

  const naoLidas = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mensagens_recebidas WHERE lida = 0'
  ).first();

  return json({ recebidas: results || [], nao_lidas: naoLidas?.n ?? 0 });
}
