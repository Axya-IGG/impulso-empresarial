import { json, erro, agora, lerConfig, gravarConfig, CHAVE_TELAO } from '../../_lib.js';

export async function onRequestGet(context) {
  const { env } = context;

  const [sorteios, total, telao] = await Promise.all([
    env.DB.prepare(
      `SELECT id, titulo, premio, criado_em, sorteado_em, vencedor_id,
              vencedor_nome, vencedor_empresa,
              total_elegiveis, posicao, verificacao, repescagem,
              ausente, chamada, origem_id
         FROM sorteios
        ORDER BY criado_em DESC`
    ).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM participantes').all(),
    lerConfig(env, CHAVE_TELAO),
  ]);

  const lista = sorteios.results || [];
  // Telao solto (nunca escolhido, ou o escolhido foi excluido) cai no mais
  // recente — o comportamento antigo, que continua certo com um sorteio so'.
  const telaoId = lista.some(s => s.id === telao) ? telao : (lista[0]?.id ?? null);

  return json({
    sorteios: lista,
    telao_id: telaoId,
    total_participantes: total.results?.[0]?.n ?? 0,
  });
}

/**
 * Cria o sorteio, ainda sem vencedor. E um passo separado do sorteio em si
 * (POST /api/admin/sorteios/<id>) de proposito: assim da para anunciar o
 * premio no telao e so' depois rodar, que e como a coisa funciona no palco.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const titulo = String(corpo?.titulo ?? '').trim().slice(0, 120);
  const premio = String(corpo?.premio ?? '').trim().slice(0, 200);
  const repescagem = corpo?.repescagem ? 1 : 0;

  if (titulo.length < 2) return erro('De um nome ao sorteio.');

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sorteios (id, titulo, premio, criado_em, repescagem)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, titulo, premio || null, agora(), repescagem).run();

  // O recem-criado vai para o telao: e' o caso comum (criar e ja anunciar) e
  // mantem o fluxo de quem so' trabalha com um sorteio por vez. Com varios
  // abertos, o operador troca pelo botao da aba.
  await gravarConfig(env, CHAVE_TELAO, id);

  return json({ ok: true, id });
}

/**
 * Escolhe qual sorteio o telao exibe. Com mais de um premio criado de
 * antemao, o telao precisava adivinhar — mostrava sempre o ultimo criado, e
 * anunciar o premio 1 depois de cadastrar o premio 2 era impossivel.
 */
export async function onRequestPatch(context) {
  const { request, env } = context;

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const id = String(corpo?.telao_id ?? '');
  if (!id) return erro('Informe o sorteio.');

  const existe = await env.DB.prepare('SELECT id FROM sorteios WHERE id = ?').bind(id).first();
  if (!existe) return erro('Sorteio nao encontrado.', 404);

  await gravarConfig(env, CHAVE_TELAO, id);
  return json({ ok: true, telao_id: id });
}
