import { json, erro, agora, normalizarChave } from '../../_lib.js';
import {
  sincronizarCertificados, formatarNome, nomeSuspeito, urlCertificados,
  legendaCertificado, enviarDocumentoWhatsapp,
} from '../../_certificados.js';

/**
 * Aba Certificados do painel. Recebe certificado quem tem presenca marcada
 * no Credenciamento; o envio e' manual, depois do evento, decidido pela
 * organizacao (09/10/2026). Ver functions/_certificados.js.
 */

const TETO_DIARIO = 250;   // mesmo teto dos dois workers (remarketing e entrega)

async function listar(env, eventoId) {
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.nome, p.whatsapp, p.presente, p.presente_em, p.credenciamento_id,
           k.nome AS nome_porta, k.produto,
           c.id AS certificado_id, c.codigo, c.baixas, c.validacoes, c.revogado,
           en.status AS envio_status, en.enviado_em, en.detalhe AS envio_detalhe, en.tentativas
      FROM cert_participantes p
      LEFT JOIN credenciamento k     ON k.id = p.credenciamento_id
      LEFT JOIN cert_certificados c  ON c.participante_id = p.id
      LEFT JOIN cert_entregas en     ON en.certificado_id = c.id AND en.canal = 'whatsapp'
     WHERE p.evento_id = ?
     ORDER BY p.nome_busca
  `).bind(eventoId).all();
  return (results || []).map(r => ({ ...r, suspeito: nomeSuspeito(r.nome) }));
}

export async function onRequestGet({ env }) {
  if (!env.CERT_SECRET) return erro('Falta o secret CERT_SECRET: sem ele não dá para gerar o código dos certificados.', 500);

  const s = await sincronizarCertificados(env);
  if (s.erro) return erro(s.erro, 409);

  const lista = await listar(env, s.evento.id);
  const gasto = await env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM envios WHERE enviado_em > datetime('now','-1 day'))
         + (SELECT COUNT(*) FROM cert_entregas
             WHERE status IN ('enviado','falha','enviando') AND enviado_em > datetime('now','-1 day')) AS n
  `).first();

  return json({
    evento: { nome: s.evento.nome, data: s.evento.data_evento },
    modelo: s.modelo,
    base: urlCertificados(env),
    emitidos_agora: s.emitidos,
    envios_24h: gasto?.n ?? 0,
    teto_diario: TETO_DIARIO,
    certificados: lista,
  });
}

/** Corrige o nome que sai no certificado. */
export async function onRequestPatch({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }

  const id = String(corpo?.id || '');
  const nome = String(corpo?.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!id) return erro('Informe o id.');
  if (nome.length < 3) return erro('Informe o nome completo.');

  const r = await env.DB.prepare(
    'UPDATE cert_participantes SET nome = ?, nome_busca = ?, atualizado_em = ? WHERE id = ?'
  ).bind(nome, normalizarChave(nome), agora(), id).run();
  if (!r.meta?.changes) return erro('Participante não encontrado.', 404);

  return json({ ok: true, nome });
}

/**
 * acao 'enviar'       -> manda agora o certificado de uma pessoa (id).
 * acao 'enviar_todos' -> coloca na fila todos os presentes que ainda nao
 *                        receberam; o worker do app de certificados manda
 *                        no ritmo seguro (4 a cada 5 min, 8h-20h).
 * acao 'cancelar_fila'-> tira da fila o que ainda nao saiu.
 * acao 'formatar'     -> aplica a correcao automatica de maiusculas a um nome.
 */
export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
  const acao = corpo?.acao;
  const quando = agora();

  if (acao === 'formatar') {
    const p = await env.DB.prepare('SELECT id, nome FROM cert_participantes WHERE id = ?').bind(String(corpo?.id || '')).first();
    if (!p) return erro('Participante não encontrado.', 404);
    const nome = formatarNome(p.nome);
    await env.DB.prepare('UPDATE cert_participantes SET nome = ?, nome_busca = ?, atualizado_em = ? WHERE id = ?')
      .bind(nome, normalizarChave(nome), quando, p.id).run();
    return json({ ok: true, nome });
  }

  if (acao === 'cancelar_fila') {
    const r = await env.DB.prepare(
      "UPDATE cert_entregas SET status = 'cancelado', detalhe = 'Cancelado no painel' WHERE status = 'fila'"
    ).run();
    return json({ ok: true, cancelados: r.meta?.changes ?? 0 });
  }

  if (acao === 'enviar_todos') {
    // Garante o certificado de todo presente antes de enfileirar.
    const s = await sincronizarCertificados(env);
    if (s.erro) return erro(s.erro, 409);

    // Entra na fila quem tem WhatsApp e nunca recebeu. Falha e cancelado
    // voltam para a fila; 'enviado' e 'enviando' nao (quem recebeu nao
    // recebe de novo pelo envio em massa, so' pelo botao da linha).
    const r = await env.DB.prepare(`
      INSERT INTO cert_entregas (certificado_id, canal, status, criado_em)
      SELECT c.id, 'whatsapp', 'fila', ?
        FROM cert_certificados c
        JOIN cert_participantes p ON p.id = c.participante_id
       WHERE p.evento_id = ? AND p.presente = 1 AND p.whatsapp IS NOT NULL AND c.revogado = 0
      ON CONFLICT(certificado_id, canal) DO UPDATE SET
        status = 'fila', detalhe = NULL, criado_em = excluded.criado_em
       WHERE cert_entregas.status IN ('falha', 'cancelado')
    `).bind(quando, s.evento.id).run();
    return json({ ok: true, enfileirados: r.meta?.changes ?? 0 });
  }

  if (acao !== 'enviar') return erro('Ação desconhecida.');

  const id = String(corpo?.id || '');
  const p = await env.DB.prepare(`
    SELECT p.id, p.nome, p.whatsapp, p.presente, c.id AS certificado_id, c.codigo, c.revogado,
           e.nome AS evento_nome
      FROM cert_participantes p
      JOIN cert_eventos e ON e.id = p.evento_id
      LEFT JOIN cert_certificados c ON c.participante_id = p.id
     WHERE p.id = ?
  `).bind(id).first();

  if (!p) return erro('Participante não encontrado.', 404);
  if (!p.presente) return erro('Esta pessoa está sem presença no credenciamento.', 409);
  if (!p.codigo) return erro('Certificado ainda não emitido. Recarregue a aba.', 409);
  if (p.revogado) return erro('Este certificado foi cancelado.', 409);
  if (!p.whatsapp) return erro('Sem WhatsApp cadastrado. Use o Baixar e envie por outro meio.', 409);

  // Reserva a linha antes de chamar a Evolution, igual ao worker: se o
  // worker pegar a mesma entrega na fila agora, um dos dois desiste.
  await env.DB.prepare(`
    INSERT INTO cert_entregas (certificado_id, canal, status, tentativas, criado_em, enviado_em)
    VALUES (?, 'whatsapp', 'enviando', 1, ?, ?)
    ON CONFLICT(certificado_id, canal) DO UPDATE SET
      status = 'enviando', tentativas = cert_entregas.tentativas + 1, enviado_em = excluded.enviado_em
  `).bind(p.certificado_id, quando, quando).run();

  const base = urlCertificados(env);
  const r = await enviarDocumentoWhatsapp(env, {
    numero: p.whatsapp,
    // fonte=entrega: o app nao conta esta leitura como download da pessoa.
    url: `${base}/c/${p.codigo}.pdf?fonte=entrega`,
    nomeArquivo: `Certificado-${p.codigo}.pdf`,
    legenda: legendaCertificado({ nome: p.nome, evento: p.evento_nome, link: `${base}/v/${p.codigo}` }),
  });

  await env.DB.prepare(
    'UPDATE cert_entregas SET status = ?, detalhe = ?, enviado_em = ? WHERE certificado_id = ? AND canal = ?'
  ).bind(r.ok ? 'enviado' : 'falha', r.ok ? null : r.detalhe, agora(), p.certificado_id, 'whatsapp').run();

  if (!r.ok) return erro(`A Evolution recusou o envio: ${r.detalhe}`, 422);
  return json({ ok: true });
}

/**
 * Exclui a linha e o certificado (cascata do banco: certificado e
 * entregas). Recusa quem ja recebeu: a pessoa tem o codigo, e apagar faria
 * o QR dela dar "nao encontrado". Quem ainda tem presenca no credenciamento
 * volta na proxima sincronizacao; o painel avisa disso antes de excluir.
 */
export async function onRequestDelete({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return erro('Informe o id.');

  const enviado = await env.DB.prepare(`
    SELECT 1 FROM cert_certificados c JOIN cert_entregas e ON e.certificado_id = c.id
     WHERE c.participante_id = ? AND e.status IN ('enviado','enviando')
  `).bind(id).first();
  if (enviado) return erro('Este certificado já foi enviado: a pessoa tem o código e não dá para excluir.', 409);

  const r = await env.DB.prepare('DELETE FROM cert_participantes WHERE id = ?').bind(id).run();
  if (!r.meta?.changes) return erro('Participante não encontrado.', 404);
  return json({ ok: true });
}
