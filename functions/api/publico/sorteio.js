import { json } from '../../_lib.js';

/**
 * Estado do telao. E so' leitura: o sorteio em si acontece em
 * /api/admin/sorteios, com sessao — o link publico nunca sorteia nada.
 *
 * O telao chama isto de poucos em poucos segundos. E assim, e nao por
 * websocket, porque Pages Functions nao mantem conexao aberta sem Durable
 * Objects, e para uma sala vendo uma tela so' a diferenca nao aparece.
 *
 * A lista de nomes vai junto de proposito: e ela que deixa a coisa
 * verificavel para quem esta assistindo — a pessoa ve o proprio nome entre os
 * concorrentes antes de o sorteio rodar.
 */
export async function onRequestGet(context) {
  const { env } = context;

  const [participantes, sorteios] = await Promise.all([
    env.DB.prepare(
      'SELECT id, nome, empresa FROM participantes ORDER BY criado_em'
    ).all(),
    env.DB.prepare(
      `SELECT id, titulo, premio, criado_em, sorteado_em, vencedor_id,
              vencedor_nome, vencedor_empresa,
              total_elegiveis, posicao, verificacao, repescagem,
              ausente, chamada
         FROM sorteios
        ORDER BY criado_em DESC`
    ).all(),
  ]);

  const lista = sorteios.results || [];

  return json({
    participantes: participantes.results || [],
    total: (participantes.results || []).length,
    // O primeiro da lista e o mais recente: e ele que o telao exibe.
    atual: lista[0] || null,
    anteriores: lista.slice(1).filter(s => s.sorteado_em),
  });
}
