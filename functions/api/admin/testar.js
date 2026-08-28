import { json, erro, normalizarWhatsapp, enviarWhatsapp, renderizar } from '../../_lib.js';

/**
 * Dispara uma mensagem avulsa para um numero escolhido, sem gravar em
 * `envios`. Serve para conferir texto e formatacao antes de soltar para a
 * base — e para checar, num aperto, se a instancia da Evolution caiu.
 */
export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const numero = normalizarWhatsapp(corpo?.whatsapp);
  if (!numero) return erro('WhatsApp invalido. Use DDD + numero.');

  const texto = String(corpo?.texto || '').trim();
  if (!texto) return erro('Escreva o texto da mensagem.');

  const nome = String(corpo?.nome || 'Teste').trim();
  const r = await enviarWhatsapp(env, numero, renderizar(texto, { nome }));

  // 422 e nao 502: a Cloudflare substitui respostas 502 vindas de uma
  // Function pela propria pagina de erro dela, e a mensagem da Evolution
  // — que e justamente o que o operador precisa ler — se perderia.
  return r.ok ? json({ ok: true }) : erro(`A Evolution recusou o envio: ${r.detalhe}`, 422);
}
