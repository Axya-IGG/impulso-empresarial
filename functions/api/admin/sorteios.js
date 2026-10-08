import { json, erro, agora } from '../../_lib.js';

export async function onRequestGet(context) {
  const { env } = context;

  const [sorteios, total] = await Promise.all([
    env.DB.prepare(
      `SELECT id, titulo, premio, criado_em, sorteado_em, vencedor_id,
              vencedor_nome, vencedor_empresa,
              total_elegiveis, posicao, verificacao, repescagem
         FROM sorteios
        ORDER BY criado_em DESC`
    ).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM participantes').all(),
  ]);

  return json({
    sorteios: sorteios.results || [],
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

  return json({ ok: true, id });
}
