import { json, agora, normalizarWhatsapp } from '../../_lib.js';

// Palavras que tiram a pessoa da lista. "SAIR" e o que o aviso do formulario
// promete; as outras entram porque e o que as pessoas escrevem de verdade
// quando querem parar de receber.
const PALAVRAS_SAIDA = ['sair', 'parar', 'pare', 'remover', 'descadastrar', 'cancelar', 'stop'];

/**
 * Recebe as mensagens que chegam na instancia da Evolution e desliga o
 * remarketing de quem pediu para sair.
 *
 * Sem isto, o "responda SAIR" do formulario seria promessa vazia — e uma
 * promessa de descadastro que nao funciona e pior do que nao ter feito.
 *
 * A URL carrega um token porque o endpoint e publico: sem ele, qualquer um
 * poderia postar um JSON forjado e descadastrar a base inteira.
 */
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!env.WEBHOOK_TOKEN || url.searchParams.get('token') !== env.WEBHOOK_TOKEN) {
    return json({ erro: 'nao autorizado' }, 401);
  }

  let evento;
  try { evento = await request.json(); } catch { return json({ ok: true }); }

  const dados = evento?.data ?? evento;

  // Mensagem que a propria instancia enviou nao interessa: so o que chega.
  if (dados?.key?.fromMe) return json({ ok: true });

  const jid = dados?.key?.remoteJid || '';
  if (jid.includes('@g.us')) return json({ ok: true });   // grupo, nao lead

  const texto = (
    dados?.message?.conversation ||
    dados?.message?.extendedTextMessage?.text ||
    ''
  ).trim().toLowerCase();

  // Compara a mensagem inteira, nao um "includes": "nao quero sair da lista"
  // nao pode descadastrar ninguem.
  const semPontuacao = texto.replace(/[.!,;:]/g, '').trim();
  if (!PALAVRAS_SAIDA.includes(semPontuacao)) return json({ ok: true });

  const numero = normalizarWhatsapp(jid.split('@')[0]);
  if (!numero) return json({ ok: true });

  const r = await env.DB.prepare(
    'UPDATE leads SET optout = 1, optout_em = ? WHERE whatsapp = ? AND optout = 0'
  ).bind(agora(), numero).run();

  return json({ ok: true, descadastrado: r.meta.changes > 0 });
}
