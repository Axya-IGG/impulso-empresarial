import { json, erro, agora, gravarConfig, lerConfig, CHAVE_TELAO } from '../../../_lib.js';

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
    `SELECT id, titulo, premio, sorteado_em, repescagem, chamada, ausente,
            vencedor_id, vencedor_nome
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
  // Ja marcado ausente quer dizer que a chamada seguinte ja existe. Sem esta
  // checagem, dois cliques no mesmo botao abriam duas "2a chamada" para o
  // mesmo premio, cada uma com um ganhador — dois nomes anunciados para um
  // premio so'. O indice unico em origem_id (migration 014) fecha a janela
  // que sobra entre esta leitura e a escrita.
  if (rechamada && sorteio.ausente) {
    return erro('A chamada seguinte deste premio ja foi aberta.', 409);
  }

  // Quem ja foi sorteado — presente ou ausente — sai do bolo. Ausente sai
  // pelo motivo obvio de nao estar na sala; o sorteado do mesmo premio sai
  // para o premio nao voltar para a mesma pessoa.
  //
  // A repescagem traz de volta quem ja ganhou, nunca quem esta ausente: a
  // pessoa nao esta na sala, e sortea-la de novo so' gastaria outra chamada.
  // Antes a repescagem nao filtrava nada, e numa rechamada o proprio ausente
  // que acabara de ser chamado podia sair sorteado de novo, na mesma hora,
  // no telao.
  //
  // Na rechamada, o ganhador desta linha ainda nao esta marcado como ausente
  // — a marcacao so' acontece depois, junto da insercao da chamada seguinte.
  // Por isso ele e' excluido aqui pelo id: sem isso, a repescagem sorteava de
  // novo, na mesma hora e no mesmo telao, a pessoa que acabara de ser chamada
  // e nao respondeu.
  const excluirAgora = (rechamada && sorteio.vencedor_id) || '';
  const sql = sorteio.repescagem
    ? `SELECT id, nome, empresa FROM participantes
        WHERE id NOT IN (SELECT vencedor_id FROM sorteios
                          WHERE ausente = 1 AND vencedor_id IS NOT NULL)
          AND id != ?
        ORDER BY criado_em`
    : `SELECT id, nome, empresa FROM participantes
        WHERE id NOT IN (SELECT vencedor_id FROM sorteios WHERE vencedor_id IS NOT NULL)
          AND id != ?
        ORDER BY criado_em`;
  const { results } = await env.DB.prepare(sql).bind(excluirAgora).all();
  const elegiveis = results || [];

  if (!elegiveis.length) {
    return erro(sorteio.repescagem
      ? 'Todo mundo da lista ja foi chamado e esta ausente.'
      : 'Nao sobrou ninguem elegivel. Ligue a repescagem para sortear de novo.', 409);
  }

  const i = indiceSorteado(elegiveis.length);
  const vencedor = elegiveis[i];
  const quando = agora();

  if (!rechamada) {
    const r = await env.DB.prepare(
      `UPDATE sorteios
          SET vencedor_id = ?, vencedor_nome = ?, vencedor_empresa = ?,
              sorteado_em = ?, total_elegiveis = ?, posicao = ?, verificacao = ?
        WHERE id = ? AND sorteado_em IS NULL`
    ).bind(
      vencedor.id, vencedor.nome, vencedor.empresa,
      quando, elegiveis.length, i + 1, codigoVerificacao(), id
    ).run();

    // Nenhuma linha mudou: outra aba (ou outro aparelho) sorteou este mesmo
    // premio entre a leitura la em cima e esta escrita. O vencedor desta
    // requisicao NAO foi gravado — devolve-lo faria o painel anunciar um
    // nome e o telao mostrar outro. Devolve o que de fato ficou no banco.
    if (!r.meta?.changes) {
      const gravado = await env.DB.prepare(
        'SELECT vencedor_id, vencedor_nome, vencedor_empresa FROM sorteios WHERE id = ?'
      ).bind(id).first();
      return json({
        ok: true,
        ja_sorteado: true,
        vencedor: {
          id: gravado?.vencedor_id,
          nome: gravado?.vencedor_nome,
          empresa: gravado?.vencedor_empresa,
        },
      });
    }

    // Sortear poe no telao: nunca pode acontecer de o operador rodar um
    // premio enquanto a plateia olha para outro.
    await gravarConfig(env, CHAVE_TELAO, id);
    return json({ ok: true, vencedor });
  }

  // Rechamada: marca o ausente e grava a chamada seguinte ja sorteada. Em
  // batch para o telao nunca pegar o estado pela metade — um ausente sem
  // substituto, ou dois ganhadores validos para o mesmo premio.
  const novoId = crypto.randomUUID();
  try {
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
  } catch (e) {
    // UNIQUE(origem_id): duas rechamadas simultaneas do mesmo premio. O batch
    // e' transacao, entao a segunda nao deixou nada pela metade.
    if (/UNIQUE|constraint/i.test(String(e))) {
      return erro('A chamada seguinte deste premio ja foi aberta.', 409);
    }
    throw e;
  }

  await gravarConfig(env, CHAVE_TELAO, novoId);
  return json({ ok: true, vencedor, id: novoId, ausente: sorteio.vencedor_nome });
}

export async function onRequestDelete(context) {
  const { params, env } = context;

  // Se o telao estava preso neste sorteio, solta: sem isso ele ficaria
  // apontando para uma linha que nao existe mais e cairia no "nenhum sorteio".
  if (await lerConfig(env, CHAVE_TELAO) === params.id) {
    await gravarConfig(env, CHAVE_TELAO, null);
  }

  // A chamada seguinte perde a referencia do pai, mas continua de pe' com o
  // proprio vencedor gravado — o historico do telao nao depende do pai.
  await env.DB.batch([
    env.DB.prepare('UPDATE sorteios SET origem_id = NULL WHERE origem_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM sorteios WHERE id = ?').bind(params.id),
  ]);
  return json({ ok: true });
}
