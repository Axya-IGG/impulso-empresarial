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
 *  ja viu na tela.
 *
 *  Com `{ "rechamada": true }` no corpo, o caminho e outro: o sorteio ja
 *  realizado tem o ganhador marcado como ausente e abre-se a chamada
 *  seguinte do mesmo premio, ja sorteada. E um clique so' porque no palco o
 *  tempo de digitar um sorteio novo e tempo de plateia esperando — mas nada
 *  e sobrescrito, a tentativa anterior fica no historico marcada. */
export async function onRequestPost(context) {
  const { request, params, env } = context;
  const id = params.id;

  // GET/DELETE nao tem corpo, e o POST de sorteio simples e disparado sem
  // body nenhum: a leitura precisa tolerar as duas coisas.
  const corpo = await request.json().catch(() => ({}));
  const rechamada = Boolean(corpo?.rechamada);

  const atual = await env.DB.prepare(
    `SELECT id, titulo, premio, sorteado_em, repescagem, chamada, vencedor_nome
       FROM sorteios WHERE id = ?`
  ).bind(id).all();
  const sorteio = atual.results?.[0];
  if (!sorteio) return erro('Sorteio nao encontrado.', 404);

  if (rechamada && !sorteio.sorteado_em) {
    return erro('Este sorteio ainda nao foi realizado.', 409);
  }
  if (!rechamada && sorteio.sorteado_em) {
    return erro('Este sorteio ja foi realizado.', 409);
  }

  // Quem ja foi sorteado — presente ou ausente — sai do bolo. Ausente sai
  // pelo motivo obvio de nao estar na sala; o sorteado do mesmo premio sai
  // para o premio nao voltar para a mesma pessoa.
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
      : 'Nao sobrou ninguem elegivel. Ligue a repescagem para sortear de novo.', 409);
  }

  const i = indiceSorteado(elegiveis.length);
  const vencedor = elegiveis[i];
  const quando = agora();

  if (!rechamada) {
    await env.DB.prepare(
      `UPDATE sorteios
          SET vencedor_id = ?, vencedor_nome = ?, vencedor_empresa = ?,
              sorteado_em = ?, total_elegiveis = ?, posicao = ?, verificacao = ?
        WHERE id = ? AND sorteado_em IS NULL`
    ).bind(
      vencedor.id, vencedor.nome, vencedor.empresa,
      quando, elegiveis.length, i + 1, codigoVerificacao(), id
    ).run();

    return json({ ok: true, vencedor });
  }

  // Rechamada: marca o ausente e grava a chamada seguinte ja sorteada. Em
  // batch para o telao nunca pegar o estado pela metade — um ausente sem
  // substituto, ou dois ganhadores validos para o mesmo premio.
  const novoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('UPDATE sorteios SET ausente = 1 WHERE id = ?').bind(id),
    env.DB.prepare(
      `INSERT INTO sorteios
         (id, titulo, premio, criado_em, repescagem, chamada, origem_id,
          vencedor_id, vencedor_nome, vencedor_empresa,
          sorteado_em, total_elegiveis, posicao, verificacao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      novoId, sorteio.titulo, sorteio.premio, quando, sorteio.repescagem,
      (sorteio.chamada || 1) + 1, id,
      vencedor.id, vencedor.nome, vencedor.empresa,
      quando, elegiveis.length, i + 1, codigoVerificacao()
    ),
  ]);

  return json({ ok: true, vencedor, id: novoId, ausente: sorteio.vencedor_nome });
}

export async function onRequestDelete(context) {
  const { params, env } = context;
  await env.DB.prepare('DELETE FROM sorteios WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
