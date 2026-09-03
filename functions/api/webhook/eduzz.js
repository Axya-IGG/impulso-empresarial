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
 * e `id` (o id da fatura, estável entre 'paid' e 'refunded' do mesmo
 * pedido — é a chave de idempotência em compras.transacao_id).
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

// Só os dois confirmados por teste real. 'invoice_canceled' é um palpite
// pela convenção dos outros dois nomes — ainda não apareceu num evento de
// verdade. Evento fora deste mapa não dá erro, só é ignorado (200 mesmo
// assim, para a Eduzz não ficar reentregando) e logado para conferir depois.
const MAPA_STATUS = {
  'myeduzz.invoice_paid': 'aprovada',
  'myeduzz.invoice_refunded': 'reembolsada',
  'myeduzz.invoice_canceled': 'cancelada',
  'myeduzz.invoice_cancelled': 'cancelada',
};

export async function onRequestGet() {
  return json({ ok: true, info: 'Webhook da Eduzz — pronto para receber POST.' });
}

export async function onRequestPost({ request, env }) {
  const bruto = await request.text();

  // Sem o secret configurado ainda, o endpoint aceita sem validar — fase de
  // transição, até a Axya localizar a chave no Órbita e eu gravar o secret.
  // TODO(eduzz): assim que EDUZZ_WEBHOOK_SECRET existir, isto passa a
  // recusar (401) qualquer requisição sem assinatura válida — não alterar
  // esta condição, só falta o secret ser gravado.
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
  // um evento que nao seja de aprovacao.
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

  try {
    await env.DB.prepare(`
      INSERT INTO compras (lead_id, produto, valor, status, transacao_id, origem, criado_em)
      VALUES (?, ?, ?, 'aprovada', ?, 'eduzz', ?)
    `).bind(leadId, produto, valor, transacaoId, quando).run();
  } catch {
    // UNIQUE(transacao_id): a Eduzz reentregou o mesmo evento. Ja processado,
    // nada a fazer — responder 200 do mesmo jeito.
  }

  return json({ ok: true, lead_id: leadId });
}
