import { json, erro, agora, normalizarWhatsapp } from '../../_lib.js';

/**
 * Webhook da Eduzz (Órbita, formato v3). Payload real capturado em 03/09
 * via `wrangler pages deployment tail` durante o teste de configuração:
 *
 *   { id, event: 'myeduzz.invoice_paid', data: {...}, sentDate }
 *
 * `data` traz `buyer` (quem comprou — usamos este; `student` também existe
 * no payload mas é para produtos de curso/assinatura e não faz sentido
 * para ingresso de evento), `items[]` (produtos da fatura), `price.paid`,
 * `utm` (a origem que veio anexada no link do checkout — ver script.js,
 * função `comUtm`) e `id` (o id da fatura, estável entre 'paid' e
 * 'refunded' do mesmo pedido — é a chave de idempotência em
 * compras.transacao_id).
 */

const enc = new TextEncoder();

/**
 * hmac('sha256', chave, corpo_bruto) — documentado em
 * developers.eduzz.com/docs/webhook/security. Comparação em tempo
 * constante pelo mesmo motivo do HMAC de sessão em _lib.js: comparar com
 * === vazaria, pelo tempo de resposta, quantos caracteres já batem.
 */
async function assinaturaValida(corpoBruto, recebida, segredo) {
  if (!recebida || !segredo) return false;
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', chave, enc.encode(corpoBruto));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

  if (hex.length !== recebida.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ recebida.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Confirmados por teste real: 'myeduzz.invoice_paid', 'myeduzz.invoice_refunded'
// e um dos dois nomes de cancelamento abaixo (confirmado indiretamente em
// 03/09 — o log de "evento ignorado" não disparou nesse teste, mas o
// payload em si não foi capturado; por isso os dois seguem mapeados).
// Evento fora deste mapa não dá erro, só é ignorado (200 mesmo assim, para
// a Eduzz não ficar reentregando) e logado para conferir depois.
const MAPA_STATUS = {
  'myeduzz.invoice_paid': 'aprovada',
  'myeduzz.invoice_refunded': 'reembolsada',
  'myeduzz.invoice_canceled': 'cancelada',
  'myeduzz.invoice_cancelled': 'cancelada',
};

/**
 * Evento de servidor pro Meta (Conversions API), disparado no instante em
 * que a Eduzz confirma a compra — é a única forma de mandar esse evento
 * pro Meta, já que o checkout roda no domínio da Eduzz e nunca carrega o
 * Pixel do nosso site.
 *
 * Match quality depende de quantos identificadores o evento carrega: email
 * e telefone (com hash, exigido pelo Meta) vêm do próprio comprador; fbp/fbc
 * (sem hash — já são IDs opacos do Meta, não dado pessoal) vêm de
 * `leads.atribuicao`, gravados no navegador da pessoa no momento em que ela
 * preencheu o popup do site (script.js, `dadosDeAtribuicaoAtuais`) — por
 * isso só existem quando o comprador passou pelo nosso formulário antes de
 * ir pro checkout; ip/user_agent vêm do mesmo cadastro.
 *
 * Nunca lança: uma falha aqui não pode derrubar o processamento da compra
 * em si (que já está gravada em `compras` quando isto é chamado).
 */
async function enviarCompraParaMeta(env, { lead, d, valor, produto, transacaoId }) {
  if (!env.META_CAPI_TOKEN || !env.META_PIXEL_ID) {
    console.log('[meta-capi] nao configurado (falta token ou pixel id)');
    return;
  }

  let atribuicao = {};
  try { atribuicao = JSON.parse(lead?.atribuicao || '{}'); } catch { /* fica vazio */ }

  const userData = {};
  if (lead?.email) userData.em = [await sha256Hex(lead.email.trim().toLowerCase())];
  // whatsapp ja' esta em E.164 sem '+' (normalizarWhatsapp) — exatamente o
  // formato que o Meta espera antes do hash.
  if (lead?.whatsapp) userData.ph = [await sha256Hex(lead.whatsapp)];
  if (atribuicao.fbp) userData.fbp = atribuicao.fbp;
  if (atribuicao.fbc) userData.fbc = atribuicao.fbc;
  if (lead?.ip) userData.client_ip_address = lead.ip;
  if (lead?.user_agent) userData.client_user_agent = lead.user_agent;

  const evento = {
    event_name: 'Purchase',
    event_time: Math.floor((!isNaN(new Date(d.paidAt)) ? new Date(d.paidAt).getTime() : Date.now()) / 1000),
    event_id: `eduzz-${transacaoId}`,
    action_source: 'website',
    event_source_url: 'https://oimpulsoempresarial.com.br/',
    user_data: userData,
    custom_data: {
      currency: d.price?.paid?.currency || d.price?.currency || 'BRL',
      value: valor,
      content_name: produto || undefined,
      content_type: 'product',
      order_id: transacaoId,
    },
  };

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [evento] }) }
    );
    const corpo = await r.text();
    console.log('[meta-capi]', r.status, corpo.slice(0, 500));
  } catch (e) {
    console.log('[meta-capi] erro de rede', String(e));
  }
}

export async function onRequestGet() {
  return json({ ok: true, info: 'Webhook da Eduzz — pronto para receber POST.' });
}

export async function onRequestPost({ request, env }) {
  const bruto = await request.text();

  if (env.EDUZZ_WEBHOOK_SECRET) {
    const ok = await assinaturaValida(bruto, request.headers.get('x-signature'), env.EDUZZ_WEBHOOK_SECRET);
    if (!ok) return erro('Assinatura invalida.', 401);
  }

  let payload;
  try { payload = JSON.parse(bruto); } catch { return erro('JSON invalido.'); }

  const d = payload?.data;
  const status = MAPA_STATUS[payload?.event];
  if (!d || !status) {
    console.log('[eduzz-webhook] evento ignorado', payload?.event);
    return json({ ok: true, ignorado: payload?.event ?? null });
  }

  const transacaoId = String(d.id || '');
  if (!transacaoId) return erro('Payload sem id de fatura.');

  // Cancelamento/reembolso so' atualiza uma compra que ja existe (criada
  // no evento 'paid' correspondente) — nunca cria linha nova a partir de
  // um evento que nao seja de aprovacao, e nunca manda evento pro Meta
  // (so' Purchase interessa pra Ads; estorno nao tem evento padrao aqui).
  if (status !== 'aprovada') {
    await env.DB.prepare('UPDATE compras SET status = ? WHERE transacao_id = ?')
      .bind(status, transacaoId).run();
    return json({ ok: true });
  }

  const nome = String(d.buyer?.name || '').trim() || 'Comprador Eduzz';
  const email = String(d.buyer?.email || '').trim().toLowerCase();
  const whatsapp = normalizarWhatsapp(d.buyer?.cellphone || d.buyer?.phone);

  // Casa por WhatsApp primeiro (mesma chave que o resto do sistema usa),
  // cai para e-mail se nao bater. Sem nenhum dos dois nao da' para mandar
  // remarketing de qualquer forma, entao nao ha' o que criar.
  let lead = whatsapp
    ? await env.DB.prepare('SELECT id FROM leads WHERE whatsapp = ?').bind(whatsapp).first()
    : null;
  if (!lead && email) {
    lead = await env.DB.prepare('SELECT id FROM leads WHERE email = ?').bind(email).first();
  }

  let leadId;
  if (lead) {
    leadId = lead.id;
  } else {
    if (!whatsapp) return erro('Comprador sem WhatsApp valido e sem lead correspondente.', 422);
    leadId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO leads (id, nome, email, whatsapp, origem, criado_em)
      VALUES (?, ?, ?, ?, 'compra-eduzz', ?)
    `).bind(leadId, nome, email || null, whatsapp, agora()).run();
  }

  const produto = (d.items || []).map(i => i?.name).filter(Boolean).join(', ') || null;
  const valor = d.price?.paid?.value ?? d.price?.value ?? null;
  // paidAt e' o instante real do pagamento segundo a Eduzz; mais preciso que
  // "agora" para a ancora de atraso do worker, que soma minutos a esta data.
  const quando = !isNaN(new Date(d.paidAt)) ? new Date(d.paidAt).toISOString() : agora();

  let compraNova = false;
  try {
    await env.DB.prepare(`
      INSERT INTO compras (lead_id, produto, valor, status, transacao_id, origem, criado_em)
      VALUES (?, ?, ?, 'aprovada', ?, 'eduzz', ?)
    `).bind(leadId, produto, valor, transacaoId, quando).run();
    compraNova = true;
  } catch {
    // UNIQUE(transacao_id): a Eduzz reentregou o mesmo evento. Ja processado
    // — inclusive o disparo pro Meta, que so' acontece abaixo quando
    // compraNova fica true. Responde 200 do mesmo jeito.
  }

  if (compraNova) {
    const leadCompleto = await env.DB.prepare(
      'SELECT email, whatsapp, ip, user_agent, atribuicao FROM leads WHERE id = ?'
    ).bind(leadId).first();
    await enviarCompraParaMeta(env, { lead: leadCompleto, d, valor, produto, transacaoId });
  }

  return json({ ok: true, lead_id: leadId });
}
