// Ingressos nominais da Eduzz (Blinket) entrando na lista da porta.
//
// Usado pelo webhook (functions/api/webhook/eduzz.js, eventos
// blinket.attendance_*) e pela importacao da planilha exportada da area de
// ingressos, que cobre quem ja tinha ingresso antes de o webhook existir.
// Os dois caminhos montam o mesmo objeto (ver ingressoDoPayload) e passam
// por aplicarIngresso, para a regra de cruzamento morar num lugar so'.

import { agora, normalizarWhatsapp, normalizarChave } from './_lib.js';

const limpar = (v, max = 160) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const emailLimpo = (v) => {
  const e = limpar(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

/**
 * So' o evento deste projeto alimenta a lista. A conta da Eduzz pode ter
 * outros eventos no Blinket, e o botao de teste da Eduzz manda um "Teste
 * evento" com participante ficticio (Maria Silva, +5515999999999): sem este
 * filtro ela entraria na porta.
 */
export function ehDoImpulso(nomeEvento) {
  return normalizarChave(nomeEvento).includes('impulso');
}

/** Payload blinket.* da Eduzz -> formato unico usado aqui. */
export function ingressoDoPayload(d) {
  const p = d?.participant || {};
  return {
    chave: limpar(p.inviteKey, 80),
    nome: limpar(p.name, 120),
    email: emailLimpo(p.email),
    whatsapp: normalizarWhatsapp(p.phone),
    status: limpar(p.status, 20) || null,
    checkInAt: p.checkInAt || null,
    produto: [d?.ticket?.name, d?.batch?.name].map(v => limpar(v, 80)).filter(Boolean).join(' - ') || null,
    comprador: {
      nome: limpar(d?.buyer?.name, 120) || null,
      email: emailLimpo(d?.buyer?.email),
      whatsapp: normalizarWhatsapp(d?.buyer?.phone),
    },
  };
}

/** Linha da lista que ja e' esta pessoa: mesmo WhatsApp ou mesmo e-mail. */
async function acharPorContato(env, whatsapp, email, { semIngresso = false } = {}) {
  if (!whatsapp && !email) return null;
  const filtro = semIngresso ? 'AND ingresso_chave IS NULL' : '';
  return env.DB.prepare(`
    SELECT * FROM credenciamento
     WHERE ((? IS NOT NULL AND whatsapp = ?) OR (? IS NOT NULL AND lower(email) = ?)) ${filtro}
     ORDER BY (lead_id IS NOT NULL) DESC, criado_em
     LIMIT 1
  `).bind(whatsapp, whatsapp, email, email).first();
}

/**
 * Aplica um ingresso na lista da porta. Devolve o que fez, para o log e
 * para o resumo da importacao.
 *
 * Ordem do cruzamento:
 *   1. o proprio ingresso ja esta na lista (mesma chave): atualiza;
 *   2. a pessoa ja esta na lista sem ingresso ligado (o comprador que veio
 *      da fatura, ou alguem que a equipe digitou na porta): liga o
 *      ingresso a essa linha em vez de criar outra;
 *   3. pessoa nova: entra, apontando para a linha do comprador que pagou.
 *
 * O nome do ingresso prevalece sobre o da compra: e' o nome de quem vai,
 * preenchido para o evento, enquanto o da compra pode ser o de uma empresa.
 */
export async function aplicarIngresso(env, ing, { tipo = 'atualizado' } = {}) {
  if (!ing.chave) return 'sem_chave';
  const quando = agora();

  const existente = await env.DB.prepare(
    'SELECT * FROM credenciamento WHERE ingresso_chave = ?'
  ).bind(ing.chave).first();

  if (tipo === 'cancelado' || ing.status === 'canceled') {
    if (!existente) return 'cancelado_ignorado';
    // Sem presenca e sem compra ligada, a linha so' existia por causa deste
    // ingresso: sai da lista. Com presenca, fica (a pessoa esteve la').
    if (!existente.presente_em && !existente.lead_id) {
      await env.DB.prepare('DELETE FROM credenciamento WHERE id = ?').bind(existente.id).run();
      return 'removido';
    }
    await env.DB.prepare(
      "UPDATE credenciamento SET ingresso_status = 'canceled' WHERE id = ?"
    ).bind(existente.id).run();
    return 'marcado_cancelado';
  }

  if (!ing.nome) return 'sem_nome';

  let linha = existente || await acharPorContato(env, ing.whatsapp, ing.email, { semIngresso: true });
  let acao;

  if (linha) {
    await env.DB.prepare(`
      UPDATE credenciamento
         SET ingresso_chave = ?, ingresso_status = ?, nome = ?,
             whatsapp = COALESCE(?, whatsapp), email = COALESCE(?, email),
             produto = COALESCE(?, produto)
       WHERE id = ?
    `).bind(ing.chave, ing.status, ing.nome, ing.whatsapp, ing.email, ing.produto, linha.id).run();
    acao = existente ? 'atualizado' : 'ligado';
  } else {
    // O comprador e' a linha da fatura (lead com compra), achada pelo
    // contato de quem pagou. Se o comprador e' o proprio participante, o
    // passo 2 acima ja teria ligado o ingresso a ele.
    const comprador = await acharPorContato(env, ing.comprador.whatsapp, ing.comprador.email);
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO credenciamento
        (id, anfitriao_id, nome, whatsapp, email, produto, ingresso_chave,
         ingresso_status, comprador_nome, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, comprador?.id ?? null, ing.nome, ing.whatsapp, ing.email,
      ing.produto || 'Ingresso nominal', ing.chave, ing.status,
      comprador ? null : ing.comprador.nome, quando,
    ).run();
    linha = { id };
    acao = 'criado';
  }

  // Check-in feito pelo app da Eduzz conta como presenca aqui tambem. So'
  // preenche quando ainda nao ha presenca: quem ja foi marcado na porta
  // mantem o horario da porta.
  if (tipo === 'checkin' || ing.checkInAt) {
    await env.DB.prepare(
      'UPDATE credenciamento SET presente_em = COALESCE(presente_em, ?) WHERE id = ?'
    ).bind(ing.checkInAt || quando, linha.id).run();
  }

  return acao;
}

/** Nome do evento blinket.* -> tipo de aplicacao. */
export function tipoDoEvento(evento) {
  if (evento === 'blinket.attendance_canceled') return 'cancelado';
  if (evento === 'blinket.attendance_checkin') return 'checkin';
  if (/^blinket\.(attendance_(added|edited|assigned|tag_changed)|ticket_edited)$/.test(evento)) return 'atualizado';
  return null;
}
