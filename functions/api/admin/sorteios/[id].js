import { json, erro, agora } from '../../../_lib.js';

/**
 * Sorteia um indice de 0 a n-1 sem vies.
 *
 * `% n` direto em cima de um aleatorio de 32 bits favorece os primeiros
 * indices sempre que n nao divide 2^32 — com 300 participantes a diferenca e
 * minuscula, mas e um sorteio com premio na frente de uma plateia, entao a
 * escolha certa e a que nao precisa de ressalva. A rejeicao descarta a faixa
 * que sobra no fim e repete.
 */
function indiceSorteado(n) {
  const limite = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limite);
  return v % n;
}

const codigoVerificacao = () => {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
};

/** Roda o sorteio. So' uma vez por sorteio: refazer apagaria o que a plateia
 *  ja viu na tela. Para tirar outro nome (vencedor ausente, por exemplo), a
 *  organizacao cria um sorteio novo — e o historico mostra os dois. */
export async function onRequestPost(context) {
  const { params, env } = context;
  const id = params.id;

  const atual = await env.DB.prepare(
    'SELECT id, sorteado_em, repescagem FROM sorteios WHERE id = ?'
  ).bind(id).all();
  const sorteio = atual.results?.[0];
  if (!sorteio) return erro('Sorteio nao encontrado.', 404);
  if (sorteio.sorteado_em) return erro('Este sorteio ja foi realizado.', 409);

  // Com repescagem desligada, quem ja ganhou sai do bolo.
  const sql = sorteio.repescagem
    ? 'SELECT id, nome, empresa FROM participantes ORDER BY criado_em'
    : `SELECT id, nome, empresa FROM participantes
        WHERE id NOT IN (SELECT vencedor_id FROM sorteios WHERE vencedor_id IS NOT NULL)
        ORDER BY criado_em`;
  const { results } = await env.DB.prepare(sql).all();
  const elegiveis = results || [];

  if (!elegiveis.length) {
    return erro(sorteio.repescagem
      ? 'Nao ha participantes cadastrados.'
      : 'Todo mundo ja ganhou. Ligue a repescagem para sortear de novo.', 409);
  }

  const i = indiceSorteado(elegiveis.length);
  const vencedor = elegiveis[i];

  await env.DB.prepare(
    `UPDATE sorteios
        SET vencedor_id = ?, vencedor_nome = ?, vencedor_empresa = ?,
            sorteado_em = ?, total_elegiveis = ?, posicao = ?, verificacao = ?
      WHERE id = ? AND sorteado_em IS NULL`
  ).bind(
    vencedor.id, vencedor.nome, vencedor.empresa,
    agora(), elegiveis.length, i + 1, codigoVerificacao(), id
  ).run();

  return json({ ok: true, vencedor });
}

export async function onRequestDelete(context) {
  const { params, env } = context;
  await env.DB.prepare('DELETE FROM sorteios WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
