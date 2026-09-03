import { agora, enviarWhatsapp, renderizar, escolherVariante } from '../../functions/_lib.js';

// Teto por rodada. O cron roda de 5 em 5 minutos: 30/rodada da ~360
// mensagens/hora no pior caso, o que so importa se o teto diario abaixo
// nao cortar antes.
const MAX_POR_RODADA = 30;

// Teto diario, somando todas as mensagens e os dois publicos. Existe porque
// o limite por rodada sozinho so trava rajada — nao evita que o numero
// mande, por exemplo, 300 mensagens em 3 horas de um dia parado, o que
// tambem chama atencao numa instancia Baileys (API nao-oficial). Ajustar
// pra cima com cautela e so depois de a base de leads justificar.
const MAX_POR_DIA = 250;

// Intervalo entre envios, aleatorio em vez de fixo: cadencia perfeitamente
// regular (sempre X ms entre mensagens) e, ela mesma, uma assinatura de
// automacao. 30 envios no pior caso ainda cabem folgados nos 5 min do cron.
const PAUSA_MIN_MS = 1200;
const PAUSA_MAX_MS = 4200;
const pausaAleatoria = () => PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS);

const dorme = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Monta a fila da rodada: pares (lead, mensagem) que ja venceram e ainda
 * nao foram enviados.
 *
 * O `NOT EXISTS` sobre `envios` e o que impede reenvio. Ele e redundante
 * com o UNIQUE(lead_id, mensagem_id) de proposito: o UNIQUE e a garantia
 * final, mas filtrar aqui evita gastar a cota da rodada com pares que
 * seriam descartados na insercao.
 *
 * O filtro de publico e' calculado na hora da consulta, nao travado no
 * agendamento: se o lead comprar entre o cadastro e o disparo, ele sai
 * sozinho de uma mensagem 'nao_compradores' sem nenhuma logica especial.
 *
 * Mensagem de 'atraso' mirando 'compradores' conta o prazo a partir da
 * COMPRA mais recente aprovada, nao do cadastro — sem isso, quem entrou na
 * lista de espera semanas atras e comprou hoje receberia a sequencia de
 * pos-venda com a contagem errada (ancorada num cadastro de semanas atras).
 */
async function montarFila(db, limite) {
  const condPublico = `
    AND (
      m.publico = 'todos'
      OR (m.publico = 'compradores'
          AND EXISTS(SELECT 1 FROM compras c WHERE c.lead_id = l.id AND c.status = 'aprovada'))
      OR (m.publico = 'nao_compradores'
          AND NOT EXISTS(SELECT 1 FROM compras c WHERE c.lead_id = l.id AND c.status = 'aprovada'))
    )
  `;

  const porAtraso = await db.prepare(`
    SELECT l.id AS lead_id, l.nome, l.whatsapp, m.id AS mensagem_id, m.texto
      FROM leads l
      JOIN mensagens m
        ON m.ativo = 1 AND m.arquivado = 0 AND m.tipo = 'atraso'
     WHERE l.optout = 0
       ${condPublico}
       AND datetime(
             CASE WHEN m.publico = 'compradores'
                  THEN (SELECT MAX(c.criado_em) FROM compras c
                         WHERE c.lead_id = l.id AND c.status = 'aprovada')
                  ELSE l.criado_em END,
             '+' || m.atraso_minutos || ' minutes'
           ) <= datetime('now')
       AND NOT EXISTS (SELECT 1 FROM envios e
                        WHERE e.lead_id = l.id AND e.mensagem_id = m.id)
     ORDER BY l.criado_em
     LIMIT ?
  `).bind(limite).all();

  // 'data': vence numa data absoluta, para o publico selecionado.
  const porData = await db.prepare(`
    SELECT l.id AS lead_id, l.nome, l.whatsapp, m.id AS mensagem_id, m.texto
      FROM leads l
      JOIN mensagens m
        ON m.ativo = 1 AND m.arquivado = 0 AND m.tipo = 'data'
     WHERE l.optout = 0
       ${condPublico}
       AND m.enviar_em <= datetime('now')
       AND NOT EXISTS (SELECT 1 FROM envios e
                        WHERE e.lead_id = l.id AND e.mensagem_id = m.id)
     ORDER BY m.enviar_em, l.criado_em
     LIMIT ?
  `).bind(limite).all();

  return [...(porData.results || []), ...(porAtraso.results || [])].slice(0, limite);
}

async function rodar(env) {
  // Conta todo status, inclusive 'erro': mesmo uma tentativa que falhou e'
  // trafego que saiu em direcao ao WhatsApp, e o teto e' sobre trafego, nao
  // so sobre sucesso.
  const jaHoje = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM envios WHERE enviado_em > datetime('now','-1 day')`
  ).first();
  const limite = Math.max(0, Math.min(MAX_POR_RODADA, MAX_POR_DIA - (jaHoje?.n ?? 0)));

  if (limite === 0) return { fila: 0, enviados: 0, erros: 0, teto_diario_atingido: true };

  const fila = await montarFila(env.DB, limite);
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

    const texto = renderizar(escolherVariante(item.texto), item);
    const r = await enviarWhatsapp(env, item.whatsapp, texto);
    await env.DB.prepare(
      'UPDATE envios SET status = ?, detalhe = ?, enviado_em = ? WHERE lead_id = ? AND mensagem_id = ?'
    ).bind(r.ok ? 'enviado' : 'erro', r.detalhe, agora(), item.lead_id, item.mensagem_id).run();

    r.ok ? enviados++ : erros++;
    if (fila.length > 1) await dorme(pausaAleatoria());
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
