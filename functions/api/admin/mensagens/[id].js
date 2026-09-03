import { json, erro, agora } from '../../../_lib.js';
import { validar } from '../mensagens.js';

/**
 * Aceita dois formatos:
 *   { acao: 'ativar' | 'desativar' | 'arquivar' | 'desarquivar' }  — toggles
 *   { titulo, texto, tipo, ... }                                    — edicao
 *
 * Os toggles sao separados da edicao porque ligar/desligar e arquivar sao
 * um clique so no painel e nao devem exigir reenviar a mensagem inteira.
 */
export async function onRequestPatch({ params, request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const toggles = {
    ativar:      ['ativo', 1],
    desativar:   ['ativo', 0],
    arquivar:    ['arquivado', 1],
    desarquivar: ['arquivado', 0],
  };

  if (corpo?.acao) {
    const t = toggles[corpo.acao];
    if (!t) return erro('Acao desconhecida.');
    const [coluna, valor] = t;
    // Arquivar tambem desliga: uma mensagem arquivada que continuasse ativa
    // seguiria disparando sem aparecer na lista principal do painel.
    const extra = corpo.acao === 'arquivar' ? ', ativo = 0' : '';
    const r = await env.DB.prepare(
      `UPDATE mensagens SET ${coluna} = ?${extra}, atualizado_em = ? WHERE id = ?`
    ).bind(valor, agora(), params.id).run();
    if (!r.meta.changes) return erro('Mensagem nao encontrada.', 404);
    return json({ ok: true });
  }

  const [d, msgErro] = validar(corpo);
  if (msgErro) return erro(msgErro);

  const r = await env.DB.prepare(`
    UPDATE mensagens
       SET titulo = ?, texto = ?, tipo = ?, atraso_minutos = ?, enviar_em = ?,
           ativo = ?, publico = ?, atualizado_em = ?
     WHERE id = ?
  `).bind(d.titulo, d.texto, d.tipo, d.atraso_minutos, d.enviar_em, d.ativo, d.publico, agora(), params.id).run();

  if (!r.meta.changes) return erro('Mensagem nao encontrada.', 404);
  return json({ ok: true });
}

export async function onRequestDelete({ params, env }) {
  const r = await env.DB.prepare('DELETE FROM mensagens WHERE id = ?').bind(params.id).run();
  if (!r.meta.changes) return erro('Mensagem nao encontrada.', 404);
  return json({ ok: true });
}
