import { json } from '../../_lib.js';

/**
 * Caixa de entrada: uma linha por CONVERSA (contato), nao mais por
 * mensagem — mostra a ultima mensagem de cada numero, em qualquer direcao,
 * igual a lista de conversas do WhatsApp Web. Antes so' existia linha pra
 * quem respondia (so' 'entrada' era gravado); agora `registrarMensagemSaida`
 * (_lib.js) grava toda mensagem NOSSA tambem, entao uma conversa aparece
 * assim que a gente manda a primeira mensagem, sem esperar resposta.
 *
 * `ultimas` pega o MAIOR id por whatsapp (nao o maior recebido_em) porque
 * dois envios no mesmo segundo empatariam por timestamp; id autoincrementa
 * na ordem de insercao, que e' a ordem real dos eventos.
 */
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    WITH ultimas AS (
      SELECT whatsapp, MAX(id) AS ultimo_id
        FROM mensagens_recebidas
       GROUP BY whatsapp
    )
    SELECT r.id, r.whatsapp, r.texto, r.recebido_em, r.direcao,
           l.nome AS lead_nome,
           (SELECT COUNT(*) FROM mensagens_recebidas x
             WHERE x.whatsapp = r.whatsapp AND x.direcao = 'entrada' AND x.lida = 0) AS nao_lidas
      FROM mensagens_recebidas r
      JOIN ultimas u     ON u.ultimo_id = r.id
      LEFT JOIN leads l  ON l.id = r.lead_id
     ORDER BY r.recebido_em DESC
     LIMIT 300
  `).all();

  const naoLidas = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mensagens_recebidas WHERE direcao = 'entrada' AND lida = 0`
  ).first();

  return json({ conversas: results || [], nao_lidas: naoLidas?.n ?? 0 });
}
