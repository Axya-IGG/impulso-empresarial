import { json } from '../../_lib.js';
import {
  onRequestGet as listarPainel,
  onRequestPost as adicionarPainel,
  onRequestPatch as presencaPainel,
  onRequestPut as editarPainel,
  onRequestDelete as excluirPainel,
} from '../admin/credenciamento.js';

/**
 * A porta sem senha (/porta?k=TOKEN), para os credenciadores (09/10/2026).
 *
 * Usa exatamente o codigo da aba Credenciamento do painel (mesma
 * sincronizacao, mesma presenca, mesmo envio do link do formulario), para
 * a porta e o painel nunca discordarem. O token ja foi conferido pelo
 * _middleware desta pasta.
 *
 * O que muda e' o que sai: o link fica no celular de gente de fora da
 * organizacao, entao a lista vai sem e-mail e com o WhatsApp mascarado (so'
 * o final, que basta para confirmar "e' voce?"), e sem a exportacao CSV.
 */

const mascarar = (w) => {
  const s = String(w || '');
  return s.length >= 12 ? `(${s.slice(2, 4)}) •••••-${s.slice(-4)}` : '';
};

export async function onRequestGet(context) {
  // Sem exportacao por aqui: o GET do painel devolve CSV com ?formato=csv.
  if (new URL(context.request.url).searchParams.has('formato')) {
    return json({ erro: 'Exportacao so pelo painel.' }, 403);
  }
  const r = await listarPainel(context);
  if (!r.ok) return r;
  const d = await r.json();

  return json({
    total: d.total,
    presentes: d.presentes,
    novos_sincronizados: d.novos_sincronizados,
    credenciamento: d.credenciamento.map(k => ({
      id: k.id,
      nome: k.nome,
      whatsapp_final: mascarar(k.whatsapp),
      tem_whatsapp: Boolean(k.whatsapp),
      comprador: Boolean(k.lead_id),
      anfitriao_id: k.anfitriao_id,
      anfitriao_nome: k.anfitriao_nome,
      comprador_nome: k.comprador_nome,
      ingresso_status: k.ingresso_status,
      avulso: !k.lead_id && !k.anfitriao_id && !k.ingresso_chave,
      presente_em: k.presente_em,
      link_enviado: Boolean(k.link_enviado_em),
      link_falhou: Boolean(k.link_detalhe),
    })),
  });
}

// O painel aceita ?formato=csv no GET; aqui nao ha rota para isso, e os
// demais metodos sao os do painel sem mudanca.
export const onRequestPost = adicionarPainel;
export const onRequestPatch = presencaPainel;
export const onRequestPut = editarPainel;
export const onRequestDelete = excluirPainel;
