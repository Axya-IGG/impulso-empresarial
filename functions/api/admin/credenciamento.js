import {
  json, erro, agora, normalizarWhatsapp, normalizarChave, tokenPublico,
  enviarWhatsapp, registrarMensagemSaida,
} from '../../_lib.js';
import { formatarNome } from '../../_certificados.js';

/**
 * Sincroniza a lista de compradores.
 *
 * Roda a cada abertura da aba, e nao num botao, porque o webhook da Eduzz
 * continua chegando durante o evento: alguem que compra no corredor precisa
 * aparecer na porta sem ninguem lembrar de clicar em nada. O UNIQUE em
 * lead_id faz o INSERT ser idempotente, entao rodar de novo nao duplica.
 *
 * O criterio e compra aprovada — cancelada e reembolsada ficam de fora.
 */
async function sincronizarCompradores(env) {
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.nome, l.whatsapp, l.email,
           (SELECT c2.produto FROM compras c2
             WHERE c2.lead_id = l.id AND c2.status = 'aprovada'
             ORDER BY c2.criado_em DESC LIMIT 1) AS produto
      FROM leads l
     WHERE EXISTS (SELECT 1 FROM compras c WHERE c.lead_id = l.id AND c.status = 'aprovada')
       AND NOT EXISTS (SELECT 1 FROM credenciamento k WHERE k.lead_id = l.id)
  `).all();

  let novos = results || [];
  if (!novos.length) return 0;

  // Quem ja esta na lista pelo ingresso nominal (webhook blinket.* ou
  // planilha, ver functions/_ingressos.js) e' a mesma pessoa da compra:
  // liga a compra a essa linha em vez de criar uma segunda.
  const ligados = new Set();
  for (const l of novos) {
    const email = String(l.email || '').toLowerCase() || null;
    const r = await env.DB.prepare(`
      UPDATE credenciamento SET lead_id = ?, produto = COALESCE(produto, ?)
       WHERE id = (SELECT id FROM credenciamento
                    WHERE lead_id IS NULL
                      AND ((? IS NOT NULL AND whatsapp = ?) OR (? IS NOT NULL AND lower(email) = ?))
                    LIMIT 1)
    `).bind(l.id, l.produto, l.whatsapp, l.whatsapp, email, email).run();
    if (r.meta?.changes) ligados.add(l.id);
  }
  novos = novos.filter(l => !ligados.has(l.id));
  if (!novos.length) return 0;

  await env.DB.batch(novos.map(l => env.DB.prepare(
    `INSERT INTO credenciamento (id, lead_id, nome, whatsapp, email, produto, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO NOTHING`
  ).bind(crypto.randomUUID(), l.id, l.nome, l.whatsapp, l.email, l.produto, agora())));

  return novos.length;
}

// Prazo do envio na porta. Sem ele, uma Evolution lenta prende a requisicao
// e a fila do credenciamento para junto — com gente esperando em pe'. Melhor
// desistir, registrar a falha e deixar a equipe passar o link na mao: a
// presenca ja' foi marcada antes do envio, entao nada se perde.
const ENVIO_TIMEOUT_MS = 8000;

const csvCampo = (v) => {
  const s = String(v ?? '');
  // Prefixo com apostrofo em campo que comeca com =, +, - ou @: sem isso o
  // Excel interpreta o conteudo como formula ao abrir o arquivo.
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const novos = await sincronizarCompradores(env);

  const [lista, respostas] = await Promise.all([
    env.DB.prepare(`
      SELECT k.id, k.lead_id, k.anfitriao_id, k.nome, k.whatsapp, k.email,
             k.produto, k.presente_em, k.link_enviado_em, k.link_detalhe,
             k.ingresso_chave, k.ingresso_status, k.comprador_nome,
             a.nome AS anfitriao_nome
        FROM credenciamento k
        LEFT JOIN credenciamento a ON a.id = k.anfitriao_id
       ORDER BY k.nome COLLATE NOCASE
    `).all(),
    env.DB.prepare('SELECT chave FROM participantes').all(),
  ]);

  // Quem ja respondeu o formulario. O cruzamento e pelo nome normalizado do
  // mesmo jeito dos dois lados — e so' pelo nome, porque o formulario pede a
  // empresa e a lista de compradores nao tem esse campo. Serve de indicacao
  // na porta ("ja preencheu?"), nao de identidade: homonimo vai marcar os
  // dois, e por isso o sorteio nunca olha para este campo.
  const responderam = new Set(
    (respostas.results || []).map(r => String(r.chave).split('|')[0])
  );

  const credenciamento = (lista.results || []).map(k => ({
    ...k,
    respondeu: responderam.has(normalizarChave(k.nome)),
  }));

  if (new URL(request.url).searchParams.get('formato') === 'csv') {
    const cab = ['Nome', 'WhatsApp', 'E-mail', 'Ingresso', 'Acompanha', 'Presenca', 'Preencheu formulario'];
    const linhas = credenciamento.map(k => [
      k.nome, k.whatsapp, k.email, k.produto, k.anfitriao_nome,
      k.presente_em || 'nao chegou', k.respondeu ? 'sim' : 'nao',
    ].map(csvCampo).join(','));
    // BOM: sem ele o Excel no Windows abre como ANSI e os acentos quebram.
    return new Response('﻿' + [cab.map(csvCampo).join(','), ...linhas].join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="credenciamento-impulso.csv"',
      },
    });
  }

  return json({
    credenciamento,
    novos_sincronizados: novos,
    total: credenciamento.length,
    presentes: credenciamento.filter(k => k.presente_em).length,
    responderam: credenciamento.filter(k => k.respondeu).length,
  });
}

/** Acompanhante: quem chega junto de um comprador de ingresso multiplo. */
export async function onRequestPost(context) {
  const { request, env } = context;

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const nome = String(corpo?.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const anfitriaoId = String(corpo?.anfitriao_id ?? '');
  const whatsapp = corpo?.whatsapp ? normalizarWhatsapp(corpo.whatsapp) : null;

  if (nome.length < 2) return erro('Informe o nome completo.');
  if (corpo?.whatsapp && !whatsapp) return erro('WhatsApp invalido. Use DDD + numero.');

  if (anfitriaoId) {
    const anfitriao = await env.DB.prepare(
      'SELECT id FROM credenciamento WHERE id = ?'
    ).bind(anfitriaoId).first();
    if (!anfitriao) return erro('Comprador nao encontrado.', 404);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO credenciamento (id, anfitriao_id, nome, whatsapp, produto, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id, anfitriaoId || null, nome, whatsapp,
    anfitriaoId ? 'Acompanhante' : 'Avulso', agora()
  ).run();

  // O id volta para o painel marcar a presenca em seguida (quem e'
  // cadastrado na porta ja chegou).
  return json({ ok: true, id });
}

/**
 * Marca presenca (ou desfaz) e, ao marcar, manda o link do formulario.
 *
 * O envio vai pela Evolution, canal unico do projeto desde 09/10. Na porta
 * ha fila atras: o envio tem prazo (ENVIO_TIMEOUT_MS) para nao travar o
 * credenciamento inteiro quando a Evolution demora a responder. O resultado
 * volta na resposta e aparece na linha, e a aba mantem o link a mao para a
 * equipe passar na marra quando o envio falhar — que no dia e o caminho
 * mais provavel para quem bloqueia mensagem de numero desconhecido.
 */
export async function onRequestPatch(context) {
  const { request, env } = context;

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const id = String(corpo?.id ?? '');
  if (!id) return erro('Informe o id.');

  const pessoa = await env.DB.prepare(
    'SELECT id, lead_id, nome, whatsapp, presente_em FROM credenciamento WHERE id = ?'
  ).bind(id).first();
  if (!pessoa) return erro('Pessoa nao encontrada.', 404);

  // Desmarcar presenca: so' tira o carimbo, nao mexe no que ja foi enviado.
  if (pessoa.presente_em) {
    await env.DB.prepare(
      'UPDATE credenciamento SET presente_em = NULL WHERE id = ?'
    ).bind(id).run();
    return json({ ok: true, presente: false });
  }

  const quando = agora();
  await env.DB.prepare(
    'UPDATE credenciamento SET presente_em = ? WHERE id = ?'
  ).bind(quando, id).run();

  if (!pessoa.whatsapp) {
    return json({ ok: true, presente: true, envio: { ok: false, detalhe: 'Sem WhatsApp cadastrado.' } });
  }

  const token = await tokenPublico(env, 'formulario');
  const link = `${new URL(request.url).origin}/formulario?k=${token}`;
  const primeiro = String(pessoa.nome || '').split(/\s+/)[0] || '';
  const texto =
    `Oi, ${primeiro}! Bem-vindo(a) ao Impulso Empresarial 2ª edição.\n\n` +
    `Responda este formulário rapidinho para concorrer aos sorteios do evento:\n${link}`;

  const r = await enviarWhatsapp(env, pessoa.whatsapp, texto, ENVIO_TIMEOUT_MS);

  await env.DB.prepare(
    'UPDATE credenciamento SET link_enviado_em = ?, link_detalhe = ? WHERE id = ?'
  ).bind(r.ok ? quando : null, r.ok ? null : String(r.detalhe || '').slice(0, 300), id).run();

  if (r.ok && pessoa.lead_id) {
    await registrarMensagemSaida(env, pessoa.lead_id, pessoa.whatsapp, texto);
  }

  return json({ ok: true, presente: true, envio: r });
}

/**
 * Corrige nome e WhatsApp de uma linha da porta (WhatsApp vazio mantem o
 * que ja estava: a pagina /porta so' mostra o numero mascarado e nao tem
 * como reenviar o numero inteiro): a vaga de ingresso sem nome
 * que ganha a pessoa que chegou, o comprador que e' uma empresa, o numero
 * digitado errado. O nome daqui e' o que vai para o certificado de quem
 * ainda nao tem um (depois de emitido, o nome se corrige na aba
 * Certificados).
 */
export async function onRequestPut({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const id = String(corpo?.id ?? '');
  const nome = String(corpo?.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const whatsapp = corpo?.whatsapp ? normalizarWhatsapp(corpo.whatsapp) : null;
  if (!id) return erro('Informe o id.');
  if (nome.length < 2) return erro('Informe o nome completo.');
  if (corpo?.whatsapp && !whatsapp) return erro('WhatsApp invalido. Use DDD + numero.');

  const r = await env.DB.prepare(`
    UPDATE credenciamento
       SET nome = ?, whatsapp = COALESCE(?, whatsapp),
           ingresso_status = CASE WHEN ingresso_status = 'unassigned' THEN 'paid' ELSE ingresso_status END
     WHERE id = ?
  `).bind(nome, whatsapp, id).run();
  if (!r.meta?.changes) return erro('Pessoa nao encontrada.', 404);

  // Se a pessoa ja tem certificado, a correcao da porta vale para ele tambem
  // (e' a correcao mais recente). Nome com maiusculas e minusculas certas,
  // igual ao que a aba Certificados faria.
  const nomeCert = formatarNome(nome);
  await env.DB.prepare(
    'UPDATE cert_participantes SET nome = ?, nome_busca = ?, whatsapp = COALESCE(?, whatsapp), atualizado_em = ? WHERE credenciamento_id = ?'
  ).bind(nomeCert, normalizarChave(nomeCert), whatsapp, agora(), id).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return erro('Informe o id.');

  // So' acompanhante/avulso sai da lista. Comprador nao: ele voltaria na
  // proxima sincronizacao, e a linha reaparecendo sozinha depois de a equipe
  // ter apagado seria pior do que nao deixar apagar.
  const pessoa = await env.DB.prepare(
    'SELECT lead_id FROM credenciamento WHERE id = ?'
  ).bind(id).first();
  if (!pessoa) return erro('Pessoa nao encontrada.', 404);
  if (pessoa.lead_id) {
    return erro('Comprador nao pode ser removido da lista — ele voltaria na proxima sincronizacao.', 409);
  }

  await env.DB.prepare('DELETE FROM credenciamento WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
