import { agora, enviarWhatsapp, enviarWhatsappMeta, separarNome, dividirVariantes, renderizar } from '../../functions/_lib.js';

// Os dois canais ficam ativos ao mesmo tempo desde 01/10: a Evolution caiu
// de novo (disparo manual feito fora deste sistema, nao tem relacao com o
// ritmo daqui) e a API oficial, mesmo com o nome de exibicao ainda
// PENDING_REVIEW na Meta, vem aceitando parte dos envios. Mensagem com
// `template_nome` tenta a API oficial primeiro; se recusar, cai pra
// Evolution no mesmo envio (ver enviarComFallback). Mensagem sem
// template_nome continua so' na Evolution, por nao ter template aprovado
// pra tentar na Meta.

// Teto por rodada. O cron roda de 5 em 5 minutos: 4/rodada da no maximo 48
// mensagens/hora. Bem baixo de proposito: quando entra uma leva de leads de
// uma vez (importacao de lista, por exemplo), todos vencem no mesmo
// instante, e o ritmo daqui e' o que impede a rajada de sair tudo junto.
const MAX_POR_RODADA = 4;

// Teto diario, somando todas as mensagens e os dois publicos. Existe porque
// o limite por rodada sozinho so trava rajada — nao evita que o numero
// mande, por exemplo, 300 mensagens em 3 horas de um dia parado. Ajustar pra
// cima com cautela e so depois de a base de leads justificar.
//
// COMPARTILHADO com o worker de entrega de certificados
// (impulso-certificados/worker-envio), que usa o mesmo numero e o mesmo
// teto. Mudar o valor aqui sem mudar la faz os dois discordarem sobre
// quanto ainda cabe, e o maior dos dois vence na pratica.
const MAX_POR_DIA = 250;

// Intervalo entre envios, aleatorio em vez de fixo: mantem o ritmo
// espalhado em vez de uma rajada compacta. Com 4 envios por rodada e pausa
// media de 50 s, a rodada dura uns 3 min e cabe nos 5 min do cron sem
// emendar na seguinte.
const PAUSA_MIN_MS = 25000;
const PAUSA_MAX_MS = 75000;
const pausaAleatoria = () => PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS);

const dorme = (ms) => new Promise(r => setTimeout(r, ms));

// Janela de envio: 8h as 20h, horario de Brasilia. Existe porque mensagem de
// WhatsApp automatica de madrugada incomoda o lead. A mensagem tipo 'data'
// ja nascia dentro da janela (enviar_em comeca as 10h, ver mensagens.js),
// mas a tipo 'atraso' so' depende de quando o lead se cadastrou ou comprou.
// Sem esta checagem, um cadastro as 23h com atraso de 1h virava mensagem
// enviada as 0h. Por isso o corte fica aqui, num unico lugar, valendo pros
// dois tipos.
const JANELA_INICIO_H = 8;
const JANELA_FIM_H = 20;

function horaBrasilia() {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date());
  return Number(partes.find(p => p.type === 'hour')?.value ?? 0);
}

// DISPARO EMERGENCIAL da virada de lote (30/09) — ver bloco proprio mais
// abaixo (rodarEmergencia). Fica aqui em cima porque montarFila tambem
// precisa excluir esta mensagem da fila normal (ver comentario dela).
const EMERGENCIA_MENSAGEM_ID = 26; // "Última chamada do lote"

/**
 * Escolhe a proxima variacao de uma mensagem numa fila fixa (nao sorteio):
 * cada tentativa de envio (sucesso ou erro) avanca uma posicao, ciclando
 * pelas variacoes na ordem em que estao no texto. Evita que o acaso
 * concentre uma variacao mais que as outras numa campanha longa — mesma
 * regra pedida pra mensagem 26, aplicada a qualquer mensagem.
 */
async function proximaVariante(env, mensagemId, texto) {
  const jaTentados = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM envios WHERE mensagem_id = ?'
  ).bind(mensagemId).first();
  const variantes = dividirVariantes(texto);
  return variantes[(jaTentados?.n ?? 0) % variantes.length];
}

/**
 * Tenta a API oficial primeiro (so' se a mensagem tiver template_nome);
 * se recusar, cai pra Evolution no mesmo envio, sem esperar a proxima
 * rodada. Sem template_nome, vai direto pra Evolution — nao ha template
 * aprovado pra tentar na Meta. O detalhe guarda os dois erros quando as
 * duas falham, pra dar pra diagnosticar qual canal (e por que) recusou.
 */
async function enviarComFallback(env, item, variante) {
  if (item.template_nome) {
    const rMeta = await enviarWhatsappMeta(env, item.whatsapp, item.template_nome, separarNome(item.nome).fn);
    if (rMeta.ok) return rMeta;
    const rEvo = await enviarWhatsapp(env, item.whatsapp, renderizar(variante, item));
    if (rEvo.ok) return rEvo;
    return { ok: false, detalhe: `Meta: ${rMeta.detalhe} | Evolution: ${rEvo.detalhe}` };
  }
  return enviarWhatsapp(env, item.whatsapp, renderizar(variante, item));
}

/**
 * Monta a fila da rodada: pares (lead, mensagem) que ja venceram e ainda
 * nao foram enviados.
 *
 * `m.id != ?` (EMERGENCIA_MENSAGEM_ID) exclui a mensagem da campanha de
 * virada de lote: ela ja' tem sua propria fila dedicada, mais rapida, em
 * rodarEmergencia — deixa-la tambem elegivel aqui so' geraria disputa pela
 * mesma vaga (o UNIQUE de `envios` ate' evitaria envio duplicado, mas
 * gastaria cota da rodada em tentativas que iam falhar por ja' reservado).
 * Tirar esta exclusao quando a campanha acabar e o bloco emergencial for
 * removido.
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
    SELECT l.id AS lead_id, l.nome, l.whatsapp, m.id AS mensagem_id, m.texto, m.template_nome
      FROM leads l
      JOIN mensagens m
        ON m.ativo = 1 AND m.arquivado = 0 AND m.tipo = 'atraso' AND m.id != ?
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
     ORDER BY CASE WHEN m.publico = 'compradores' THEN 0 ELSE 1 END, l.criado_em
     LIMIT ?
  `).bind(EMERGENCIA_MENSAGEM_ID, limite).all();

  // 'data': vence num dia especifico, mas nao dispara pra base inteira no
  // mesmo instante — enviar_em guarda o INICIO de uma janela de 10h (10h as
  // 20h, horario de Brasilia) e cada lead recebe um deslocamento dentro dela.
  // O deslocamento vem de um hash simples e deterministico de (lead, mensagem)
  // — mesmo par sempre cai no mesmo minuto — em vez de RANDOM(), que mudaria
  // a cada rodada e faria o mesmo lead ora entrar ora sair da fila. Sem
  // gravar nada a mais no banco, a fila fica estavel e ainda assim espalhada
  // ao longo do dia, que e' o ponto: uma rajada de centenas de mensagens no
  // mesmo minuto e' um dos sinais mais fortes de automacao que derrubam um
  // numero.
  // O filtro abaixo (m.enviar_em >= referencia) e' o que impede mensagem
  // "antiga" pra quem so' entrou no publico DEPOIS que a janela dela passou.
  // Sem ele, alguem que compra hoje mas vira "comprador" depois do dia de um
  // Spotlight ja' agendado (ex.: mensagem de 21/09, compra em 23/09) recebia
  // esse aquecimento vencido — e podia chegar antes ate' da Confirmacao
  // imediata, porque os dois ficavam "devidos" na mesma rodada. Referencia e'
  // a data da COMPRA pra mensagem de 'compradores' (mesma logica do
  // 'atraso' acima) e o cadastro pros demais publicos.
  const porData = await db.prepare(`
    SELECT l.id AS lead_id, l.nome, l.whatsapp, m.id AS mensagem_id, m.texto, m.template_nome
      FROM leads l
      JOIN mensagens m
        ON m.ativo = 1 AND m.arquivado = 0 AND m.tipo = 'data' AND m.id != ?
     WHERE l.optout = 0
       ${condPublico}
       AND datetime(
             m.enviar_em,
             '+' || ((l.rowid * 2654435761 + m.id * 40503) % 600) || ' minutes'
           ) <= datetime('now')
       AND datetime(m.enviar_em) >= datetime(
             CASE WHEN m.publico = 'compradores'
                  THEN (SELECT MAX(c.criado_em) FROM compras c
                         WHERE c.lead_id = l.id AND c.status = 'aprovada')
                  ELSE l.criado_em END
           )
       AND NOT EXISTS (SELECT 1 FROM envios e
                        WHERE e.lead_id = l.id AND e.mensagem_id = m.id)
     ORDER BY m.enviar_em, l.criado_em
     LIMIT ?
  `).bind(EMERGENCIA_MENSAGEM_ID, limite).all();

  // Atraso primeiro (Confirmacao imediata inclusa): pra quem acabou de
  // comprar, a confirmacao e' a primeira coisa que devia chegar, nunca um
  // aquecimento que por acaso tambem ficou devido na mesma rodada.
  return [...(porAtraso.results || []), ...(porData.results || [])].slice(0, limite);
}

// Quanto trafego ja' saiu pelo numero da Evolution ('axya') nas ultimas 24h,
// somando `envios` (esta) e `cert_entregas` (impulso-certificados), que usa
// o MESMO numero — ver comentario de MAX_POR_DIA. Contar todo status,
// inclusive 'erro': mesmo uma tentativa que falhou e' trafego que saiu em
// direcao ao WhatsApp, e o teto e' sobre trafego, nao so' sobre sucesso.
// Compartilhada por `rodar` e `rodarEmergencia` porque as duas gastam da
// MESMA cota diaria do MESMO numero.
async function contarGastoHoje(env) {
  const jaHoje = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM envios WHERE enviado_em > datetime('now','-1 day')`
  ).first();

  // Em consulta separada com try/catch, e nao como subconsulta na de cima,
  // porque num banco sem a tabela (outro ambiente, banco novo) o SQLite
  // falha ao preparar a instrucao INTEIRA — nao devolve NULL, e nenhum
  // COALESCE salvaria. Junto, um app de certificados ausente derrubaria o
  // remarketing, que esta no ar com trafego pago. Separado, ele so' nao
  // soma nada.
  let certificadosHoje = 0;
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cert_entregas
        WHERE status IN ('enviado','falha','enviando')
          AND enviado_em > datetime('now','-1 day')`
    ).first();
    certificadosHoje = r?.n ?? 0;
  } catch (e) {
    console.log('[remarketing] cert_entregas indisponivel, teto sem ela:', String(e).slice(0, 120));
  }

  return (jaHoje?.n ?? 0) + certificadosHoje;
}

async function rodar(env, forcarForaDaJanela = false) {
  const hora = horaBrasilia();
  if (!forcarForaDaJanela && (hora < JANELA_INICIO_H || hora >= JANELA_FIM_H)) {
    return { fila: 0, enviados: 0, erros: 0, fora_da_janela: true, hora_brasilia: hora };
  }

  const gasto = await contarGastoHoje(env);
  const limite = Math.max(0, Math.min(MAX_POR_RODADA, MAX_POR_DIA - gasto));

  if (limite === 0) return { fila: 0, enviados: 0, erros: 0, teto_diario_atingido: true };

  const fila = await montarFila(env.DB, limite);
  let enviados = 0, erros = 0;

  for (const item of fila) {
    // Calculada ANTES da reserva: proximaVariante conta envios ja'
    // existentes desta mensagem, e a reserva abaixo cria mais um.
    const variante = await proximaVariante(env, item.mensagem_id, item.texto);

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

    const r = await enviarComFallback(env, item, variante);
    await env.DB.prepare(
      'UPDATE envios SET status = ?, detalhe = ?, enviado_em = ? WHERE lead_id = ? AND mensagem_id = ?'
    ).bind(r.ok ? 'enviado' : 'erro', r.detalhe, agora(), item.lead_id, item.mensagem_id).run();

    r.ok ? enviados++ : erros++;
    if (fila.length > 1) await dorme(pausaAleatoria());
  }

  return { fila: fila.length, enviados, erros };
}

// ==================================================================
// DISPARO EMERGENCIAL — virada de lote (30/09), so' enquanto durar
// ==================================================================
// Fila dedicada, mais rapida que o ritmo normal de rodar() — pedido
// explicito do usuario pra cobrir os leads restantes antes das 20h de hoje.
// Remover este bloco (aqui e em functions/_lib.js) quando a campanha
// acabar; a exclusao de EMERGENCIA_MENSAGEM_ID em montarFila tambem sai
// junto.
// 5min30s em vez de 6min: com 76 leads restantes e a janela fechando as 20h,
// 6 em 6 deixaria uns 2 leads de fora hoje: nesse ritmo cabem ~81 envios ate
// la, com folga.
const EMERGENCIA_INTERVALO_MS = 5.5 * 60 * 1000;

/**
 * No maximo 1 envio por chamada — e' o que garante o ritmo de 1 a cada 6
 * min mesmo rodando junto de um cron de 5 em 5: a maioria das rodadas ve
 * que o intervalo ainda nao passou e nao faz nada. Publico e' sempre
 * "quem nao comprou, nao pediu pra sair, e ainda nao recebeu esta mensagem
 * especifica" — igual ao filtro de publico 'nao_compradores' de montarFila,
 * so' que fixo nesta unica mensagem em vez de variar por linha da tabela.
 */
async function rodarEmergencia(env) {
  const hora = horaBrasilia();
  if (hora < JANELA_INICIO_H || hora >= JANELA_FIM_H) {
    return { fora_da_janela: true, hora_brasilia: hora };
  }

  const ultimo = await env.DB.prepare(
    `SELECT MAX(enviado_em) AS em FROM envios WHERE mensagem_id = ?`
  ).bind(EMERGENCIA_MENSAGEM_ID).first();

  if (ultimo?.em && Date.now() - new Date(ultimo.em).getTime() < EMERGENCIA_INTERVALO_MS) {
    return { aguardando_intervalo: true };
  }

  const gasto = await contarGastoHoje(env);
  if (gasto >= MAX_POR_DIA) return { teto_diario_atingido: true };

  const mensagem = await env.DB.prepare('SELECT texto, ativo, arquivado FROM mensagens WHERE id = ?')
    .bind(EMERGENCIA_MENSAGEM_ID).first();
  if (!mensagem) return { mensagem_nao_encontrada: true };
  // Pausar ou arquivar a mensagem no painel tem que parar esta fila tambem:
  // antes, rodarEmergencia buscava so' o texto pelo ID fixo e ignorava os
  // dois campos, entao a campanha continuava mandando mesmo depois do
  // usuario pausar e arquivar (lote ja virou em 01/10).
  if (!mensagem.ativo || mensagem.arquivado) return { mensagem_pausada_ou_arquivada: true };

  const proximo = await env.DB.prepare(`
    SELECT l.id AS lead_id, l.nome, l.whatsapp
      FROM leads l
     WHERE l.optout = 0
       AND NOT EXISTS (SELECT 1 FROM compras c WHERE c.lead_id = l.id AND c.status = 'aprovada')
       AND NOT EXISTS (SELECT 1 FROM envios e WHERE e.lead_id = l.id AND e.mensagem_id = ?)
     ORDER BY l.criado_em
     LIMIT 1
  `).bind(EMERGENCIA_MENSAGEM_ID).first();

  if (!proximo) return { concluido: true };

  // Fila, nao sorteio: pedido explicito do usuario pra distribuir as
  // variacoes igualmente ao longo da campanha em vez de deixar o acaso
  // concentrar uma mais que as outras (ver proximaVariante).
  const variante = await proximaVariante(env, EMERGENCIA_MENSAGEM_ID, mensagem.texto);

  try {
    await env.DB.prepare(
      `INSERT INTO envios (lead_id, mensagem_id, status, enviado_em) VALUES (?, ?, 'enviando', ?)`
    ).bind(proximo.lead_id, EMERGENCIA_MENSAGEM_ID, agora()).run();
  } catch {
    return { ja_reservado: true }; // outra chamada pegou este lead primeiro
  }

  const r = await enviarWhatsapp(env, proximo.whatsapp, renderizar(variante, proximo));
  await env.DB.prepare(
    `UPDATE envios SET status = ?, detalhe = ?, enviado_em = ? WHERE lead_id = ? AND mensagem_id = ?`
  ).bind(r.ok ? 'enviado' : 'erro', r.detalhe, agora(), proximo.lead_id, EMERGENCIA_MENSAGEM_ID).run();

  return { enviado: r.ok, lead_id: proximo.lead_id, detalhe: r.detalhe };
}

export default {
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(rodar(env));
    ctx.waitUntil(rodarEmergencia(env));
  },

  // Disparo manual, para testar sem esperar o cron. Protegido pelo mesmo
  // segredo do painel, senao qualquer um esvaziaria a fila na hora errada.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('X-Admin-Senha') !== env.ADMIN_SENHA) {
      return new Response('Nao autorizado', { status: 401 });
    }
    if (url.pathname === '/emergencia') return Response.json(await rodarEmergencia(env));
    if (url.pathname !== '/rodar') return new Response('Not found', { status: 404 });
    // ?forcar=1 ignora a janela de horario — so' pra testar de madrugada
    // sem esperar o dia seguinte; o cron nunca manda essa flag.
    const forcar = url.searchParams.get('forcar') === '1';
    return Response.json(await rodar(env, forcar));
  },
};
