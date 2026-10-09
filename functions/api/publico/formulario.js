import { json, erro, agora, ipDaRequisicao, chaveParticipante } from '../../_lib.js';

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
    return erro('Muitos cadastros deste endereco. Procure a organizacao.', 429);
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
  if (!FAIXAS.includes(funcionarios)) return erro('Escolha a quantidade de funcionarios.');

  const id = crypto.randomUUID();
  const chave = chaveParticipante(nome, empresa);

  await env.DB.prepare(
    `INSERT INTO participantes (id, nome, empresa, cargo, funcionarios, chave, origem, criado_em, ip)
     VALUES (?, ?, ?, ?, ?, ?, 'formulario', ?, ?)
     ON CONFLICT(chave) DO UPDATE SET
       nome = excluded.nome, empresa = excluded.empresa,
       cargo = excluded.cargo, funcionarios = excluded.funcionarios`
  ).bind(id, nome, empresa, cargo, funcionarios, chave, agora(), ip).run();

  // Devolve o total para o formulario poder dizer "voce e o Nº X na lista",
  // que e o que fecha o ciclo para quem acabou de responder.
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM participantes').all();

  return json({ ok: true, total: total.results?.[0]?.n ?? 0 });
}

/** O formulario busca as faixas daqui para nao duplicar a lista no HTML. */
export async function onRequestGet() {
  return json({ faixas: FAIXAS });
}
