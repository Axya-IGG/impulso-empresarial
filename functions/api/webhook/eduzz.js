import { json } from '../../_lib.js';

/**
 * Webhook da Eduzz — VERSAO DE DESCOBERTA.
 *
 * Ainda nao sei o formato exato do payload que a conta da Axya vai mandar
 * (a Eduzz tem duas geracoes de webhook documentadas, e o "Orbita" atual
 * pode diferir em detalhe de instalacao pra instalacao). Em vez de adivinhar
 * nomes de campo e escrever um parser que quebra silenciosamente na
 * primeira notificacao real, esta versao so registra o que chegou e
 * responde 200 — o suficiente pra configurar o webhook no painel da Eduzz,
 * disparar uma venda de teste, e ver o payload de verdade no "Historico de
 * envios" do Orbita (a resposta abaixo ecoa o corpo recebido) antes de
 * escrever a logica real de casamento com `leads` e insercao em `compras`.
 *
 * PROXIMO PASSO (apos ver um payload real):
 *   1. Validar a assinatura HMAC que a Eduzz manda no header (documentado
 *      em "Seguranca" no developers.eduzz.com/docs/webhook) usando
 *      env.EDUZZ_WEBHOOK_SECRET — SEM ISSO qualquer um pode forjar uma
 *      notificacao de "venda aprovada" pra este endpoint.
 *   2. Extrair nome/email/telefone do comprador e status da transacao do
 *      formato real.
 *   3. Casar com um lead existente (normalizarWhatsapp, depois e-mail); se
 *      nao achar, criar o lead com origem 'compra-eduzz'.
 *   4. status aprovado -> INSERT em `compras` (status='aprovada',
 *      origem='eduzz', transacao_id=<id da fatura>) com ON CONFLICT
 *      ignorando (o indice unico parcial em compras.transacao_id ja cobre
 *      reentrega do mesmo evento).
 *   5. status cancelado/reembolsado -> UPDATE compras SET status=... WHERE
 *      transacao_id = <id> (mantém o historico, so' muda o status).
 */
export async function onRequestGet() {
  return json({ ok: true, info: 'Webhook da Eduzz — pronto para receber POST.' });
}

export async function onRequestPost({ request, env }) {
  const bruto = await request.text();

  let corpo = null;
  try { corpo = JSON.parse(bruto); } catch { /* pode vir form-encoded no formato antigo */ }

  const cabecalhos = {};
  for (const [k, v] of request.headers) cabecalhos[k] = v;

  // Log estruturado: aparece em tempo real com
  // `npx wrangler pages deployment tail --project-name=impulso-empresarial`
  // (rodar com as duas variaveis de ambiente do perfil Axya, como no
  // deploy.ps1/db.ps1).
  console.log('[eduzz-webhook] recebido', JSON.stringify({ cabecalhos, corpo, bruto: corpo ? undefined : bruto }));

  // TODO(eduzz): trocar este eco por validacao de assinatura + parser real
  // assim que o formato estiver confirmado (ver comentario acima do arquivo).
  return json({
    ok: true,
    modo: 'descoberta — nada foi gravado no banco ainda',
    recebido: { cabecalhos, corpo: corpo ?? bruto },
  });
}
