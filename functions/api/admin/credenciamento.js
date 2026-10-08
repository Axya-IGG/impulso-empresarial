import {
  json, erro, agora, normalizarWhatsapp, normalizarChave, tokenPublico,
  enviarWhatsapp, enviarWhatsappMetaTexto, registrarMensagemSaida,
} from '../../_lib.js';

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

  const novos = results || [];
  if (!novos.length) return 0;

  await env.DB.batch(novos.map(l => env.DB.prepare(
    `INSERT INTO credenciamento (id, lead_id, nome, whatsapp, email, produto, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO NOTHING`
  ).bind(crypto.randomUUID(), l.id, l.nome, l.whatsapp, l.email, l.produto, agora())));

  return novos.length;
}

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

  await env.DB.prepare(
    `INSERT INTO credenciamento (id, anfitriao_id, nome, whatsapp, produto, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), anfitriaoId || null, nome, whatsapp,
    anfitriaoId ? 'Acompanhante' : 'Avulso', agora()
  ).run();

  return json({ ok: true });
}

/**
 * Marca presenca (ou desfaz) e, ao marcar, manda o link do formulario.
 *
 * O envio tenta a API oficial e cai para a Evolution, na ordem — a mesma do
 * reenviar.js. Vale avisar que texto livre pela Meta so' passa dentro da
 * janela de 24h desde a ultima mensagem da pessoa, e no dia do evento a
 * maioria estara fora dela; por isso o resultado do envio e devolvido e
 * mostrado na linha, e a aba tem o link a mao para a equipe passar na
 * marra quando falhar.
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

  let r = await enviarWhatsappMetaTexto(env, pessoa.whatsapp, texto);
  if (!r.ok) {
    const rEvo = await enviarWhatsapp(env, pessoa.whatsapp, texto);
    r = rEvo.ok ? rEvo : { ok: false, detalhe: `Meta: ${r.detalhe} | Evolution: ${rEvo.detalhe}` };
  }

  await env.DB.prepare(
    'UPDATE credenciamento SET link_enviado_em = ?, link_detalhe = ? WHERE id = ?'
  ).bind(r.ok ? quando : null, r.ok ? null : String(r.detalhe || '').slice(0, 300), id).run();

  if (r.ok && pessoa.lead_id) {
    await registrarMensagemSaida(env, pessoa.lead_id, pessoa.whatsapp, texto);
  }

  return json({ ok: true, presente: true, envio: r });
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
