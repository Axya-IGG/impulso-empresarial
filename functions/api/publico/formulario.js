import { json, erro, agora, ipDaRequisicao, chaveParticipante, normalizarChave } from '../../_lib.js';

// Por hora, por IP. Alto de proposito: no evento o wi-fi do hotel sai num IP
// so' para a sala inteira, e a operadora de celular tambem agrupa muita gente
// atras do mesmo endereco. Com 60 (o valor anterior) uma plateia de cem
// pessoas respondendo na primeira hora veria a 61a em diante levar "muitos
// cadastros deste endereco" — justamente quem a trava nao deveria pegar. Quem
// de fato protege este endpoint e' o token do link, entregue so' na porta; o
// numero aqui e' rede contra script maluco, nao contra participante.
const LIMITE_POR_IP = 500;

const FAIXAS = [
  'Até 9 funcionários',
  'De 10 a 49',
  'De 50 a 99',
  'De 100 a 499',
  '500 ou mais',
];

/**
 * Cadastro do participante no dia do evento. Quem termina entra
 * automaticamente na lista do sorteio — nao ha passo separado de inscricao.
 *
 * Reenviar o mesmo nome+empresa atualiza o cadastro em vez de criar outro
 * (UNIQUE em `chave`): sem isso, quem abre o link duas vezes no celular
 * acabaria com duas chances no sorteio.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = ipDaRequisicao(request);

  const desde = new Date(Date.now() - 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM participantes WHERE ip = ? AND criado_em > ?'
  ).bind(ip, desde).all();
  if ((results?.[0]?.n ?? 0) >= LIMITE_POR_IP) {
    return erro('Muitos cadastros deste endereço. Procure a organização.', 429);
  }

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const limpo = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const nome = limpo(corpo?.nome, 120);
  const empresa = limpo(corpo?.empresa, 120);
  const cargo = limpo(corpo?.cargo, 120);
  const funcionarios = limpo(corpo?.funcionarios, 40);

  if (nome.length < 2)    return erro('Informe seu nome completo.');
  if (empresa.length < 2) return erro('Informe o nome da empresa.');
  if (cargo.length < 2)   return erro('Informe seu cargo.');
  if (!FAIXAS.includes(funcionarios)) return erro('Escolha a quantidade de funcionários.');

  const id = crypto.randomUUID();
  const chave = chaveParticipante(nome, empresa);

  // Uma pessoa, uma chance. O UNIQUE em `chave` (nome+empresa) ja' cobria
  // quem reenvia os MESMOS dados — reabrir o link no celular atualiza o
  // cadastro em vez de criar outro. O que faltava era a variacao: trocar so'
  // a empresa ("Axya", depois "Axya IGG") gerava uma segunda linha com o
  // mesmo nome, e no sorteio isso e' um bilhete a mais.
  //
  // Por isso a checagem e' pelo nome normalizado sozinho. Quando o nome bate
  // mas a empresa e' outra, a resposta e' RECUSA, nao atualizacao: se fosse
  // atualizacao, dois homonimos de empresas diferentes — raro, mas possivel
  // numa sala de cem pessoas — virariam um so', e o primeiro sumiria do
  // sorteio sem ninguem perceber. Recusando, nada se perde: quem for
  // homonimo de verdade procura a organizacao, que inclui pelo
  // "+ Adicionar a mao" do painel (esse caminho nao passa por aqui, de
  // proposito — e' a valvula de escape humana).
  //
  // O LIKE e' seguro sem escape: normalizarChave so' deixa [a-z0-9 ], entao
  // nem % nem _ sobrevivem no nome.
  const homonimo = await env.DB.prepare(
    'SELECT chave, empresa FROM participantes WHERE chave LIKE ?'
  ).bind(normalizarChave(nome) + '|%').first();

  if (homonimo && homonimo.chave !== chave) {
    return erro(
      'Esse nome já está na lista do sorteio. Se você ainda não preencheu, ' +
      'procure a organização do evento.', 409);
  }

  await env.DB.prepare(
    `INSERT INTO participantes (id, nome, empresa, cargo, funcionarios, chave, origem, criado_em, ip)
     VALUES (?, ?, ?, ?, ?, ?, 'formulario', ?, ?)
     ON CONFLICT(chave) DO UPDATE SET
       nome = excluded.nome, empresa = excluded.empresa,
       cargo = excluded.cargo, funcionarios = excluded.funcionarios`
  ).bind(id, nome, empresa, cargo, funcionarios, chave, agora(), ip).run();

  // Sem o total de participantes: a organizacao preferiu nao mostrar quantos
  // estao concorrendo (09/10/2026).
  return json({ ok: true });
}

/** O formulario busca as faixas daqui para nao duplicar a lista no HTML. */
export async function onRequestGet() {
  return json({ faixas: FAIXAS });
}
