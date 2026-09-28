import { json, agora, normalizarWhatsapp } from '../../_lib.js';

/**
 * Webhook da API oficial do WhatsApp (Cloud API/Graph), configurado em
 * developers.facebook.com → seu app → WhatsApp → Configuração → Webhooks.
 *
 * Dois métodos com papéis bem diferentes:
 *
 *   GET  — handshake de verificação. A Meta chama esta URL UMA VEZ, na hora
 *          de salvar a configuração, com `hub.verify_token` (o valor que
 *          colamos no campo "Verificar token") e `hub.challenge` (um texto
 *          aleatório). Só devolvendo esse challenge de volta, sem alterar
 *          nada, é que a Meta aceita a URL.
 *
 *   POST — evento de verdade: mensagem recebida (`value.messages[]`) ou
 *          atualização de status de uma mensagem enviada (`value.statuses[]`,
 *          ex.: "delivered", "read", "failed" — ainda não usado aqui porque
 *          o envio pela Cloud API não está ligado ainda; ver [[project_impulso_empresarial]]).
 *
 * Mesmas palavras de saída do webhook da Evolution (functions/api/webhook/
 * evolution.js) — o texto "responda SAIR" do formulário vale pros dois
 * numeros/APIs enquanto a migração não termina.
 */
const PALAVRAS_SAIDA = ['sair', 'parar', 'pare', 'remover', 'descadastrar', 'cancelar', 'stop'];

const enc = new TextEncoder();

/**
 * X-Hub-Signature-256: `sha256=<hex>`, hmac com o App Secret sobre o corpo
 * bruto (developers.facebook.com/docs/graph-api/webhooks/getting-started
 * #validating-payloads). Só valida se o secret já foi configurado — assim
 * o endpoint funciona (sem essa checada) desde o primeiro deploy, e fica
 * mais forte assim que o App Secret for gerado e colado como secret, sem
 * precisar coordenar os dois passos no mesmo instante.
 */
async function assinaturaValida(corpoBruto, recebida, segredo) {
  if (!recebida?.startsWith('sha256=') || !segredo) return false;
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', chave, enc.encode(corpoBruto));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

  const esperada = recebida.slice('sha256='.length);
  if (hex.length !== esperada.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperada.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const desafio = url.searchParams.get('hub.challenge') || '';

  if (modo === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(desafio, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return json({ erro: 'verificacao invalida' }, 403);
}

export async function onRequestPost({ request, env }) {
  const bruto = await request.text();

  if (env.WHATSAPP_APP_SECRET) {
    const ok = await assinaturaValida(bruto, request.headers.get('x-hub-signature-256'), env.WHATSAPP_APP_SECRET);
    if (!ok) return json({ erro: 'assinatura invalida' }, 401);
  }

  let payload;
  try { payload = JSON.parse(bruto); } catch { return json({ ok: true }); }

  const mudancas = (payload?.entry || []).flatMap(e => e?.changes || []);

  for (const mudanca of mudancas) {
    const mensagens = mudanca?.value?.messages || [];
    for (const msg of mensagens) {
      const texto = (msg?.text?.body || '').trim().toLowerCase();
      const semPontuacao = texto.replace(/[.!,;:]/g, '').trim();
      if (!PALAVRAS_SAIDA.includes(semPontuacao)) continue;

      const numero = normalizarWhatsapp(msg?.from);
      if (!numero) continue;

      await env.DB.prepare(
        'UPDATE leads SET optout = 1, optout_em = ? WHERE whatsapp = ? AND optout = 0'
      ).bind(agora(), numero).run();
    }
    // value.statuses[] (delivered/read/failed) fica pra quando o envio pela
    // Cloud API estiver ligado — sem isso ainda gravado em `envios`, nao ha'
    // linha pra atualizar.
  }

  return json({ ok: true });
}
