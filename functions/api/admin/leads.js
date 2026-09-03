import { json, erro, agora, normalizarWhatsapp, emailValido } from '../../_lib.js';

const csvCampo = (v) => {
  const s = String(v ?? '');
  // Prefixo de aspas + escape: campo comecando com =, +, - ou @ e
  // interpretado como formula pelo Excel ao abrir o CSV.
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  if (url.searchParams.get('formato') === 'csv') {
    const { results } = await env.DB.prepare(
      `SELECT nome, email, whatsapp, origem, criado_em, optout
         FROM leads ORDER BY criado_em DESC`
    ).all();

    const cab = ['Nome', 'E-mail', 'WhatsApp', 'Origem', 'Cadastro', 'Descadastrado'];
    const linhas = (results || []).map(l => [
      l.nome, l.email, l.whatsapp, l.origem || '', l.criado_em, l.optout ? 'sim' : 'nao',
    ].map(csvCampo).join(','));

    // BOM: sem ele o Excel no Windows abre o arquivo em ANSI e quebra os acentos.
    return new Response('﻿' + [cab.map(csvCampo).join(','), ...linhas].join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-impulso-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const busca = (url.searchParams.get('busca') || '').trim();
  const like = `%${busca}%`;

  const { results } = busca
    ? await env.DB.prepare(
        `SELECT * FROM leads
          WHERE nome LIKE ? OR email LIKE ? OR whatsapp LIKE ?
          ORDER BY criado_em DESC LIMIT 500`
      ).bind(like, like, like).all()
    : await env.DB.prepare('SELECT * FROM leads ORDER BY criado_em DESC LIMIT 500').all();

  const estat = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM leads) AS total,
      (SELECT COUNT(*) FROM leads WHERE optout = 1) AS descadastrados,
      (SELECT COUNT(*) FROM leads WHERE criado_em > datetime('now','-1 day')) AS ultimas24h,
      (SELECT COUNT(*) FROM envios WHERE status = 'enviado') AS enviados,
      (SELECT COUNT(*) FROM envios WHERE status = 'erro') AS erros
  `).first();

  return json({ leads: results || [], estat });
}

// Cadastro manual pelo operador do painel — cliente que comprou por fora
// (telefone, presencial) e precisa entrar na régua de remarketing mesmo
// sem ter passado pelo formulário público.
export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const nome = String(corpo?.nome || '').trim().replace(/\s+/g, ' ');
  const email = String(corpo?.email || '').trim().toLowerCase();
  const origem = String(corpo?.origem || '').trim().slice(0, 40) || 'manual';
  const whatsapp = normalizarWhatsapp(corpo?.whatsapp);

  if (nome.length < 2)     return erro('Informe o nome.');
  if (!emailValido(email)) return erro('E-mail invalido.');
  if (!whatsapp)           return erro('WhatsApp invalido. Use DDD + numero.');

  const existente = await env.DB.prepare('SELECT id FROM leads WHERE whatsapp = ?')
    .bind(whatsapp).first();
  // Erro explícito em vez de sobrescrever: um cadastro manual normalmente
  // corrige um dado (nome, e-mail) e um ON CONFLICT silencioso esconderia
  // do operador que ele estava editando um lead existente, não criando um novo.
  if (existente) return erro('Já existe um lead com esse WhatsApp.', 409);

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO leads (id, nome, email, whatsapp, origem, criado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, nome, email, whatsapp, origem, agora()).run();

  return json({ ok: true, id }, 201);
}
