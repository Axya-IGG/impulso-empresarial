import { json, erro, agora, chaveParticipante, normalizarChave } from '../../_lib.js';

const FAIXAS = [
  'Até 9 funcionários',
  'De 10 a 49',
  'De 50 a 99',
  'De 100 a 499',
  '500 ou mais',
];

const csvCampo = (v) => {
  const s = String(v ?? '');
  // Prefixo com apostrofo em campo que comeca com =, +, - ou @: sem isso o
  // Excel interpreta o conteudo como formula ao abrir o arquivo.
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.nome, p.empresa, p.cargo, p.funcionarios, p.chave,
            p.origem, p.criado_em,
            (SELECT COUNT(*) FROM sorteios s WHERE s.vencedor_id = p.id) AS vitorias
       FROM participantes p
      ORDER BY p.criado_em DESC`
  ).all();
  const linhas = results || [];

  // O formulario nao pede contato — sao quatro perguntas e pronto, porque cada
  // campo a mais na fila do credenciamento e' gente desistindo de responder.
  // Quem respondeu, porem, passou antes pela porta, e la' o WhatsApp e o e-mail
  // ja' estao. Cruzamos pelo nome normalizado (mesma funcao dos dois lados)
  // pra resposta virar algo que da' pra acionar depois do evento.
  const { results: porta } = await env.DB.prepare(
    'SELECT nome, whatsapp, email, produto, presente_em FROM credenciamento'
  ).all();
  const contatos = new Map();
  for (const c of porta || []) {
    const k = normalizarChave(c.nome);
    // Homonimo na lista da porta: fica o primeiro. E' indicacao operacional,
    // nao identidade — nada no sorteio depende deste cruzamento.
    if (k && !contatos.has(k)) contatos.set(k, c);
  }
  for (const l of linhas) {
    const c = contatos.get(String(l.chave || '').split('|')[0]);
    l.whatsapp = c?.whatsapp || null;
    l.email = c?.email || null;
    l.produto = c?.produto || null;
    l.presente_em = c?.presente_em || null;
  }

  if (url.searchParams.get('formato') === 'csv') {
    const cab = ['Nome', 'Empresa', 'Cargo', 'Funcionarios', 'WhatsApp', 'E-mail',
                 'Origem', 'Cadastro', 'Vitorias'];
    const corpo = linhas.map(l => [
      l.nome, l.empresa, l.cargo, l.funcionarios, l.whatsapp, l.email,
      l.origem, l.criado_em, l.vitorias,
    ].map(csvCampo).join(','));
    // BOM: sem ele o Excel no Windows abre o arquivo como ANSI e os acentos
    // viram caracteres quebrados.
    return new Response('﻿' + [cab.map(csvCampo).join(','), ...corpo].join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="participantes-impulso.csv"',
      },
    });
  }

  return json({ participantes: linhas, faixas: FAIXAS });
}

/** Cadastro manual, para quem a organizacao inclui na mao. */
export async function onRequestPost(context) {
  const { request, env } = context;

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const limpo = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const nome = limpo(corpo?.nome, 120);
  const empresa = limpo(corpo?.empresa, 120);
  const cargo = limpo(corpo?.cargo, 120);
  const funcionarios = limpo(corpo?.funcionarios, 40);

  if (nome.length < 2)    return erro('Informe o nome completo.');
  if (empresa.length < 2) return erro('Informe a empresa.');
  if (cargo.length < 2)   return erro('Informe o cargo.');
  if (!FAIXAS.includes(funcionarios)) return erro('Escolha a quantidade de funcionarios.');

  const chave = chaveParticipante(nome, empresa);
  const existe = await env.DB.prepare(
    'SELECT id FROM participantes WHERE chave = ?'
  ).bind(chave).all();
  if (existe.results?.length) {
    return erro('Ja existe um participante com esse nome nessa empresa.', 409);
  }

  await env.DB.prepare(
    `INSERT INTO participantes (id, nome, empresa, cargo, funcionarios, chave, origem, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`
  ).bind(crypto.randomUUID(), nome, empresa, cargo, funcionarios, chave, agora()).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return erro('Informe o id.');

  // Sai mesmo tendo ganhado: `sorteios` guarda o nome do vencedor em coluna
  // propria desde a migration 011, entao o historico do telao continua de pe'
  // depois da exclusao. So' o vinculo e desfeito, para o participante nao
  // reaparecer na contagem de elegiveis.
  await env.DB.batch([
    env.DB.prepare('UPDATE sorteios SET vencedor_id = NULL WHERE vencedor_id = ?').bind(id),
    env.DB.prepare('DELETE FROM participantes WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}
