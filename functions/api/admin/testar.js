import { json, erro, normalizarWhatsapp, enviarWhatsappMeta } from '../../_lib.js';

/**
 * Dispara o template de uma mensagem para um número escolhido, sem gravar
 * em `envios`. Serve para conferir, num número de verdade, que o template
 * já aprovado pela Meta chega formatado certo antes de ligá-lo pra base
 * inteira (ver template_nome em migrations/006_mensagens_template.sql).
 *
 * Só funciona para mensagem que já tem template — não há mais envio de
 * texto livre avulso, a Cloud API não aceita isso fora da janela de 24h.
 */
export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const numero = normalizarWhatsapp(corpo?.whatsapp);
  if (!numero) return erro('WhatsApp invalido. Use DDD + numero.');

  const templateNome = String(corpo?.template_nome || '').trim();
  if (!templateNome) return erro('Esta mensagem ainda nao tem um template aprovado pela Meta.');

  const nome = String(corpo?.nome || 'Teste').trim();
  const r = await enviarWhatsappMeta(env, numero, templateNome, nome);

  // 422 e nao 502: a Cloudflare substitui respostas 502 vindas de uma
  // Function pela propria pagina de erro dela, e a mensagem da Meta — que e
  // justamente o que o operador precisa ler — se perderia.
  return r.ok ? json({ ok: true }) : erro(`A Meta recusou o envio: ${r.detalhe}`, 422);
}
