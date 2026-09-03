import { json, erro, agora, normalizarWhatsapp, montarUserData, enviarEventoMeta } from '../../_lib.js';

/**
 * Webhook da Eduzz (Órbita, formato v3). Payload real capturado em 03/09
 * via `wrangler pages deployment tail` durante o teste de configuração:
 *
 *   { id, event: 'myeduzz.invoice_paid', data: {...}, sentDate }
 *
 * `data` traz `buyer` (quem comprou — usamos este; `student` também existe
 * no payload mas é para produtos de curso/assinatura e não faz sentido
 * para ingresso de evento), `items[]` (produtos da fatura), `price.paid`,
 * `utm` (a origem que veio anexada no link do checkout), `tracker.code1`
 * (o `trk` que functions/_middleware.js anexou no link — casamento exato
 * com o lead, não depende de bater e-mail/telefone) e `id` (o id da
 * fatura, estável entre 'paid' e 'refunded' do mesmo pedido — é a chave de
 * idempotência em compras.transacao_id).
 *
 * IMPORTANTE: o botão "Testar eventos" do Órbita manda um payload fixo que
 * NUNCA inclui tracker.code1 (confirmado — não é bug daqui). Testar o
 * casamento por trk de verdade exige uma compra real (ou com cupom de
 * 100%) passando pelo link decorado, não o botão de teste.
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
  const trk = String(d.tracker?.code1 || '') || null;

  // Casamento em ordem de confianca: trk primeiro (exato — a mesma sessao
  // que preencheu o popup e' a que foi pro checkout), whatsapp depois
  // (mesma chave que o resto do sistema usa), e-mail por ultimo. Sem
  // nenhum dos tres da' para mandar remarketing de qualquer forma, entao
  // nao ha' o que casar nem criar.
  let lead = trk
    ? await env.DB.prepare('SELECT * FROM leads WHERE trk = ?').bind(trk).first()
    : null;
  if (!lead && whatsapp) {
    lead = await env.DB.prepare('SELECT * FROM leads WHERE whatsapp = ?').bind(whatsapp).first();
  }
  if (!lead && email) {
    lead = await env.DB.prepare('SELECT * FROM leads WHERE email = ?').bind(email).first();
  }

  let leadId;
  if (lead) {
    leadId = lead.id;
    // Se achou por whatsapp/e-mail mas o lead ainda nao tinha trk (cadastro
    // anterior a esta migracao, ou cookie bloqueado no cadastro), grava
    // agora — proximas compras da mesma pessoa passam a casar direto.
    if (trk && !lead.trk) {
      await env.DB.prepare('UPDATE leads SET trk = ? WHERE id = ?').bind(trk, leadId).run();
    }
  } else {
    if (!whatsapp) return erro('Comprador sem WhatsApp valido e sem lead correspondente.', 422);
    leadId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO leads (id, nome, email, whatsapp, origem, criado_em, trk)
      VALUES (?, ?, ?, ?, 'compra-eduzz', ?, ?)
    `).bind(leadId, nome, email || null, whatsapp, agora(), trk).run();
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
    try {
      const leadCompleto = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
      const sessao = trk ? await env.DB.prepare('SELECT * FROM sessoes WHERE trk = ?').bind(trk).first() : null;
      const userData = await montarUserData({ lead: leadCompleto, sessao });

      await enviarEventoMeta(env, {
        eventName: 'Purchase',
        eventId: `eduzz-${transacaoId}`,
        eventTime: Math.floor(new Date(quando).getTime() / 1000),
        eventSourceUrl: 'https://oimpulsoempresarial.com.br/',
        userData,
        customData: {
          currency: d.price?.paid?.currency || d.price?.currency || 'BRL',
          value: valor,
          content_name: produto || undefined,
          content_type: 'product',
          order_id: transacaoId,
        },
      });
    } catch (e) {
      console.log('[eduzz-webhook] erro ao montar/enviar evento Meta', String(e));
    }
  }

  return json({ ok: true, lead_id: leadId });
}
