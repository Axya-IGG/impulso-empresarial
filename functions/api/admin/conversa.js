import { json, erro, enviarWhatsapp, registrarMensagemSaida } from '../../_lib.js';

/**
 * Thread completa de um contato (as duas direcoes), pra abrir a conversa
 * como no WhatsApp Web em vez de uma mensagem solta. Abrir a conversa ja
 * marca como lida toda mensagem 'entrada' pendente dela — igual ao
 * WhatsApp de verdade, onde abrir o chat e que zera o contador, nao um
 * botao separado por mensagem.
 */
export async function onRequestGet({ request, env }) {
  const whatsapp = new URL(request.url).searchParams.get('whatsapp');
  if (!whatsapp) return erro('Informe o whatsapp.');

  const lead = await env.DB.prepare('SELECT nome FROM leads WHERE whatsapp = ?').bind(whatsapp).first();

  const { results } = await env.DB.prepare(`
    SELECT id, texto, recebido_em, direcao
      FROM mensagens_recebidas
     WHERE whatsapp = ?
     ORDER BY id ASC
  `).bind(whatsapp).all();

  await env.DB.prepare(
    `UPDATE mensagens_recebidas SET lida = 1 WHERE whatsapp = ? AND direcao = 'entrada' AND lida = 0`
  ).bind(whatsapp).run();

  return json({ mensagens: results || [], lead_nome: lead?.nome || null });
}

/**
 * Responde pela Evolution. A API oficial da Meta saiu de todos os caminhos
 * de envio do projeto em 09/10: o numero oficial recusava tudo ("Object
 * with ID ... does not exist, cannot be loaded due to missing permissions")
 * e, mesmo funcionando, texto livre so' passa na janela de 24h desde a
 * ultima mensagem da pessoa. Um canal so' tambem torna o erro legivel — o
 * detalhe que aparece no painel vem sempre do mesmo lugar.
 */
export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }

  const whatsapp = String(corpo?.whatsapp || '').trim();
  const texto = String(corpo?.texto || '').trim();
  if (!whatsapp) return erro('Informe o whatsapp.');
  if (!texto) return erro('Escreva a resposta.');

  const r = await enviarWhatsapp(env, whatsapp, texto);
  if (!r.ok) return erro(`A Evolution recusou o envio: ${r.detalhe}`, 422);

  const lead = await env.DB.prepare('SELECT id FROM leads WHERE whatsapp = ?').bind(whatsapp).first();
  await registrarMensagemSaida(env, lead?.id ?? null, whatsapp, texto);

  return json({ ok: true });
}
