import {
  json, erro, agora, ipDaRequisicao,
  normalizarWhatsapp, emailValido,
} from '../_lib.js';

const LIMITE_POR_IP = 20;      // por hora — trava de flood, nao de uso normal
const COOKIE_LEAD = 'impulso_lead';

/**
 * Captura do lead no primeiro clique do CTA.
 *
 * O reconhecimento de quem ja preencheu tem tres camadas, da mais rapida
 * para a mais confiavel:
 *   1. localStorage no navegador (o front nem chama esta rota);
 *   2. cookie impulso_lead, de 1 ano — sobrevive a limpeza do localStorage;
 *   3. UNIQUE em leads.whatsapp — mesmo que as duas primeiras falhem, o
 *      mesmo numero atualiza o cadastro em vez de duplicar.
 *
 * O IP NAO entra nessa identificacao de proposito: numa operadora movel ou
 * num escritorio, dezenas de pessoas compartilham o mesmo IP e uma seria
 * confundida com a outra. Ele fica gravado so para auditoria e trava de
 * flood.
 */
export async function onRequestPost({ request, env }) {
  const ip = ipDaRequisicao(request);

  const desde = new Date(Date.now() - 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND criado_em > ?'
  ).bind(ip, desde).all();
  if ((results?.[0]?.n ?? 0) >= LIMITE_POR_IP) {
    return erro('Muitos cadastros deste endereco. Tente mais tarde.', 429);
  }

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const nome = String(corpo?.nome || '').trim().replace(/\s+/g, ' ');
  const email = String(corpo?.email || '').trim().toLowerCase();
  const origem = String(corpo?.origem || '').slice(0, 40);
  const whatsapp = normalizarWhatsapp(corpo?.whatsapp);

  if (nome.length < 2)    return erro('Informe seu nome.');
  if (!emailValido(email)) return erro('E-mail invalido.');
  if (!whatsapp)          return erro('WhatsApp invalido. Use DDD + numero.');

  const ua = (request.headers.get('User-Agent') || '').slice(0, 300);
  const quando = agora();

  // ON CONFLICT: quem volta com o mesmo numero atualiza os dados e mantem
  // o criado_em original — se ele fosse reescrito, a sequencia de mensagens
  // por atraso recomecaria do zero a cada visita.
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO leads (id, nome, email, whatsapp, origem, ip, user_agent, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(whatsapp) DO UPDATE SET
      nome = excluded.nome,
      email = excluded.email,
      origem = excluded.origem
  `).bind(id, nome, email, whatsapp, origem, ip, ua, quando).run();

  const lead = await env.DB.prepare('SELECT id FROM leads WHERE whatsapp = ?')
    .bind(whatsapp).first();

  return json({ ok: true, id: lead?.id }, 200, {
    'Set-Cookie': `${COOKIE_LEAD}=1; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
  });
}
