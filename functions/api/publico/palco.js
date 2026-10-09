import { json, tokenPublico } from '../../_lib.js';
import {
  onRequestGet as listarPainel,
  onRequestPost as criarPainel,
  onRequestPatch as telaoPainel,
} from '../admin/sorteios.js';

/**
 * O sorteio sem senha (/palco?k=TOKEN), para o pessoal do suporte
 * (09/10/2026). Mesmas acoes da aba Sorteio do painel e o mesmo codigo dela,
 * para os dois nunca discordarem; o token ja foi conferido pelo
 * _middleware desta pasta. As acoes por sorteio (sortear, rechamar, editar,
 * excluir) ficam em palco/[id].js.
 *
 * O GET devolve tambem o link do telao, para o suporte abrir a tela de
 * projecao sem precisar pedir o endereco a ninguem.
 */
export async function onRequestGet(context) {
  const r = await listarPainel(context);
  if (!r.ok) return r;
  const d = await r.json();
  const origem = new URL(context.request.url).origin;
  return json({ ...d, telao_link: `${origem}/sorteio?k=${await tokenPublico(context.env, 'sorteio')}` });
}

export const onRequestPost = criarPainel;
export const onRequestPatch = telaoPainel;
