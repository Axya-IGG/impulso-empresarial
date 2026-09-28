import { json, erro, agora, enviarWhatsappMeta, separarNome } from '../../_lib.js';

/**
 * Reenvio manual de um envio com erro, disparado pelo operador na aba
 * Envios. Atualiza o MESMO registro em vez de criar um novo, porque o
 * UNIQUE(lead_id, mensagem_id) de `envios` proíbe uma segunda linha pro
 * mesmo par — e é esse índice que impede o cron de mandar a mesma mensagem
 * duas vezes, então o reenvio manual tem que jogar pelas mesmas regras.
 */
export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }

  const id = Number(corpo?.id);
  if (!Number.isInteger(id)) return erro('Envio inválido.');

  const envio = await env.DB.prepare(`
    SELECT e.id, e.status, l.nome, l.whatsapp, l.optout,
           m.template_nome
      FROM envios e
      JOIN leads l     ON l.id = e.lead_id
      JOIN mensagens m ON m.id = e.mensagem_id
     WHERE e.id = ?
  `).bind(id).first();

  if (!envio) return erro('Envio não encontrado.', 404);
  if (envio.status !== 'erro') return erro('Só é possível reenviar um envio com status "erro".');
  if (envio.optout) return erro('Este lead descadastrou-se; reenvio bloqueado.');
  if (!envio.template_nome) return erro('Esta mensagem ainda não tem um template aprovado pela Meta.');

  const r = await enviarWhatsappMeta(env, envio.whatsapp, envio.template_nome, separarNome(envio.nome).fn);

  await env.DB.prepare(
    'UPDATE envios SET status = ?, detalhe = ?, enviado_em = ? WHERE id = ?'
  ).bind(r.ok ? 'enviado' : 'erro', r.detalhe, agora(), id).run();

  return r.ok ? json({ ok: true }) : erro(`A Meta recusou o envio: ${r.detalhe}`, 422);
}
