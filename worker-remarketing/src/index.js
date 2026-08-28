import { agora, enviarWhatsapp, renderizar } from '../../functions/_lib.js';

// Teto por rodada. O cron roda de 5 em 5 minutos, entao isso da ~360
// mensagens/hora no pior caso. O limite existe porque disparar centenas de
// mensagens em rajada por uma instancia Baileys e a forma mais rapida de o
// numero ser bloqueado pelo WhatsApp.
const MAX_POR_RODADA = 30;

// Intervalo entre envios, para o trafego nao sair em rajada.
const PAUSA_MS = 1500;

const dorme = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Monta a fila da rodada: pares (lead, mensagem) que ja venceram e ainda
 * nao foram enviados.
 *
 * O `NOT EXISTS` sobre `envios` e o que impede reenvio. Ele e redundante
 * com o UNIQUE(lead_id, mensagem_id) de proposito: o UNIQUE e a garantia
 * final, mas filtrar aqui evita gastar a cota da rodada com pares que
 * seriam descartados na insercao.
 */
async function montarFila(db) {
  // 'atraso': vence em criado_em + N minutos, por lead.
  const porAtraso = await db.prepare(`
    SELECT l.id AS lead_id, l.nome, l.whatsapp, m.id AS mensagem_id, m.texto
      FROM leads l
      JOIN mensagens m
        ON m.ativo = 1 AND m.arquivado = 0 AND m.tipo = 'atraso'
     WHERE l.optout = 0
       AND datetime(l.criado_em, '+' || m.atraso_minutos || ' minutes') <= datetime('now')
       AND NOT EXISTS (SELECT 1 FROM envios e
                        WHERE e.lead_id = l.id AND e.mensagem_id = m.id)
     ORDER BY l.criado_em
     LIMIT ?
  `).bind(MAX_POR_RODADA).all();

  // 'data': vence numa data absoluta, para toda a base ativa.
  const porData = await db.prepare(`
    SELECT l.id AS lead_id, l.nome, l.whatsapp, m.id AS mensagem_id, m.texto
      FROM leads l
      JOIN mensagens m
        ON m.ativo = 1 AND m.arquivado = 0 AND m.tipo = 'data'
     WHERE l.optout = 0
       AND m.enviar_em <= datetime('now')
       AND NOT EXISTS (SELECT 1 FROM envios e
                        WHERE e.lead_id = l.id AND e.mensagem_id = m.id)
     ORDER BY m.enviar_em, l.criado_em
     LIMIT ?
  `).bind(MAX_POR_RODADA).all();

  return [...(porData.results || []), ...(porAtraso.results || [])].slice(0, MAX_POR_RODADA);
}

async function rodar(env) {
  const fila = await montarFila(env.DB);
  let enviados = 0, erros = 0;

  for (const item of fila) {
    // Reserva a vaga ANTES de enviar. Se o Worker morrer no meio da rodada,
    // o pior caso e uma mensagem marcada como enviada que nao saiu — melhor
    // do que a pessoa receber a mesma mensagem duas vezes.
    try {
      await env.DB.prepare(
        `INSERT INTO envios (lead_id, mensagem_id, status, enviado_em) VALUES (?, ?, 'enviando', ?)`
      ).bind(item.lead_id, item.mensagem_id, agora()).run();
    } catch {
      continue; // ja reservado por outra rodada — o UNIQUE barrou
    }

    const r = await enviarWhatsapp(env, item.whatsapp, renderizar(item.texto, item));
    await env.DB.prepare(
      'UPDATE envios SET status = ?, detalhe = ?, enviado_em = ? WHERE lead_id = ? AND mensagem_id = ?'
    ).bind(r.ok ? 'enviado' : 'erro', r.detalhe, agora(), item.lead_id, item.mensagem_id).run();

    r.ok ? enviados++ : erros++;
    if (fila.length > 1) await dorme(PAUSA_MS);
  }

  return { fila: fila.length, enviados, erros };
}

export default {
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(rodar(env));
  },

  // Disparo manual, para testar sem esperar o cron. Protegido pelo mesmo
  // segredo do painel, senao qualquer um esvaziaria a fila na hora errada.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/rodar') return new Response('Not found', { status: 404 });
    if (request.headers.get('X-Admin-Senha') !== env.ADMIN_SENHA) {
      return new Response('Nao autorizado', { status: 401 });
    }
    return Response.json(await rodar(env));
  },
};
