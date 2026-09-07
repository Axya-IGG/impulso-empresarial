import { json } from '../../_lib.js';

/**
 * Filtros vêm todos por query string e são combinados com AND. `de`/`ate`
 * chegam como AAAA-MM-DD (o painel só deixa escolher o dia, não a hora) e
 * são convertidos aqui para os limites do dia em Brasília — sem isso um
 * envio às 21h de Brasília (0h UTC do dia seguinte) cairia no dia errado
 * pra quem está filtrando.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const busca = (url.searchParams.get('busca') || '').trim();
  const mensagemId = url.searchParams.get('mensagem_id') || '';
  const status = url.searchParams.get('status') || '';
  const de = url.searchParams.get('de') || '';
  const ate = url.searchParams.get('ate') || '';

  const condicoes = [];
  const params = [];

  if (busca) {
    condicoes.push('(l.nome LIKE ? OR l.whatsapp LIKE ?)');
    const like = `%${busca}%`;
    params.push(like, like);
  }
  if (mensagemId) {
    condicoes.push('e.mensagem_id = ?');
    params.push(mensagemId);
  }
  if (status) {
    condicoes.push('e.status = ?');
    params.push(status);
  }
  if (de) {
    condicoes.push('e.enviado_em >= ?');
    params.push(new Date(`${de}T00:00:00-03:00`).toISOString());
  }
  if (ate) {
    // Limite exclusivo no início do dia SEGUINTE: inclui o dia inteiro
    // escolhido sem precisar acertar "23:59:59.999" na mão.
    const fim = new Date(`${ate}T00:00:00-03:00`);
    fim.setUTCDate(fim.getUTCDate() + 1);
    condicoes.push('e.enviado_em < ?');
    params.push(fim.toISOString());
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(`
    SELECT e.id, e.status, e.detalhe, e.enviado_em,
           l.nome AS lead_nome, l.whatsapp AS lead_whatsapp,
           m.titulo AS mensagem_titulo
      FROM envios e
      LEFT JOIN leads l     ON l.id = e.lead_id
      LEFT JOIN mensagens m ON m.id = e.mensagem_id
      ${where}
     ORDER BY e.enviado_em DESC
     LIMIT 500
  `).bind(...params).all();

  // Lista de mensagens pro select do filtro — sempre a universo INTEIRO
  // (nunca aplica os filtros acima), senão escolher uma mensagem some as
  // opções das outras e ninguém consegue trocar de filtro sem antes limpá-lo.
  const { results: mensagens } = await env.DB.prepare(`
    SELECT DISTINCT m.id, m.titulo
      FROM envios e
      JOIN mensagens m ON m.id = e.mensagem_id
     ORDER BY m.titulo
  `).all();

  return json({ envios: results || [], mensagens: mensagens || [] });
}
