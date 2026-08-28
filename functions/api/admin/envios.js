import { json } from '../../_lib.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT e.id, e.status, e.detalhe, e.enviado_em,
           l.nome AS lead_nome, l.whatsapp AS lead_whatsapp,
           m.titulo AS mensagem_titulo
      FROM envios e
      LEFT JOIN leads l     ON l.id = e.lead_id
      LEFT JOIN mensagens m ON m.id = e.mensagem_id
     ORDER BY e.enviado_em DESC
     LIMIT 200
  `).all();

  return json({ envios: results || [] });
}
