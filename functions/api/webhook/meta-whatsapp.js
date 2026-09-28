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
 *          ex.: "delivered", "read", "failed" — ainda não usado aqui; sem
 *          nada gravado em `envios` com o wamid retornado no envio, não há
 *          linha pra atualizar com o status).
 *
 * Toda mensagem recebida é guardada em `mensagens_recebidas`, pra aparecer
 * na caixa de entrada do painel e dar pra responder (ver
 * functions/api/admin/recebidas.js).
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
      const textoOriginal = (msg?.text?.body || '').trim();
      if (!textoOriginal) continue;   // sem texto (audio, figurinha...): nada pra guardar

      const numero = normalizarWhatsapp(msg?.from);
      if (!numero) continue;

      const lead = await env.DB.prepare('SELECT id FROM leads WHERE whatsapp = ?').bind(numero).first();
      await env.DB.prepare(
        'INSERT INTO mensagens_recebidas (lead_id, whatsapp, texto, recebido_em) VALUES (?, ?, ?, ?)'
      ).bind(lead?.id ?? null, numero, textoOriginal, agora()).run();

      const semPontuacao = textoOriginal.toLowerCase().replace(/[.!,;:]/g, '').trim();
      if (!PALAVRAS_SAIDA.includes(semPontuacao)) continue;

      await env.DB.prepare(
        'UPDATE leads SET optout = 1, optout_em = ? WHERE whatsapp = ? AND optout = 0'
      ).bind(agora(), numero).run();
    }
    // value.statuses[] fica pra depois - ver comentario no topo do arquivo.
  }

  return json({ ok: true });
}
