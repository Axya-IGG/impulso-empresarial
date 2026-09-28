import { json, erro, agora, enviarWhatsapp, enviarWhatsappMetaTexto } from '../../../_lib.js';

/**
 * Aceita dois formatos, igual mensagens/[id].js:
 *   { lida: true|false }  — marca como lida/nao lida sem responder
 *   { responder: '...' }  — manda a resposta pela MESMA API que recebeu
 *                           (campo `canal` da mensagem original) e marca
 *                           como lida
 *
 * A API oficial so' aceita texto livre (sem template) dentro da janela de
 * 24h desde a ultima mensagem do lead — se a Meta recusar por isso, o erro
 * volta pro painel explicando (nao tenta template nenhum aqui).
 */
export async function onRequestPatch({ params, request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  if (typeof corpo?.lida === 'boolean') {
    const r = await env.DB.prepare('UPDATE mensagens_recebidas SET lida = ? WHERE id = ?')
      .bind(corpo.lida ? 1 : 0, params.id).run();
    if (!r.meta.changes) return erro('Mensagem nao encontrada.', 404);
    return json({ ok: true });
  }

  const texto = String(corpo?.responder || '').trim();
  if (!texto) return erro('Escreva a resposta.');

  const msg = await env.DB.prepare('SELECT whatsapp, canal FROM mensagens_recebidas WHERE id = ?')
    .bind(params.id).first();
  if (!msg) return erro('Mensagem nao encontrada.', 404);

  const r = msg.canal === 'meta'
    ? await enviarWhatsappMetaTexto(env, msg.whatsapp, texto)
    : await enviarWhatsapp(env, msg.whatsapp, texto);

  if (!r.ok) return erro(`A ${msg.canal === 'meta' ? 'Meta' : 'Evolution'} recusou o envio: ${r.detalhe}`, 422);

  await env.DB.prepare('UPDATE mensagens_recebidas SET lida = 1 WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
