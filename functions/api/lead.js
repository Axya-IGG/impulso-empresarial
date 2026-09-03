import {
  json, erro, agora, ipDaRequisicao, lerCookie,
  normalizarWhatsapp, emailValido, montarUserData, enviarEventoMeta,
} from '../_lib.js';

const LIMITE_POR_IP = 20;      // por hora — trava de flood, nao de uso normal
const COOKIE_LEAD = 'impulso_lead';

// So os campos que o Conversions API usa sobrevivem — nunca confie no JSON
// que chega do navegador sem filtrar antes de gravar. Caminho de reserva
// para quando nao ha sessao em `sessoes` (cookie bloqueado, ou lead de
// antes da migration 004).
const CAMPOS_ATRIBUICAO = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbp', 'fbc'];

function normalizarAtribuicao(bruto) {
  if (!bruto) return null;
  let obj;
  try { obj = JSON.parse(bruto); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;

  const limpo = {};
  for (const c of CAMPOS_ATRIBUICAO) {
    const v = obj[c];
    if (typeof v === 'string' && v && v.length <= 300) limpo[c] = v;
  }
  return Object.keys(limpo).length ? JSON.stringify(limpo) : null;
}

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
export async function onRequestPost(context) {
  const { request, env } = context;
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
  const atribuicao = normalizarAtribuicao(corpo?.atribuicao);
  // trk vem do cookie que functions/_middleware.js gerou na borda — mais
  // confiavel que qualquer coisa que o corpo do POST possa afirmar, porque
  // nao depende de JS ter rodado a tempo no navegador.
  const trk = lerCookie(request, 'trk') || null;

  // ON CONFLICT: quem volta com o mesmo numero atualiza os dados e mantem
  // o criado_em original — se ele fosse reescrito, a sequencia de mensagens
  // por atraso recomecaria do zero a cada visita. atribuicao so' sobrescreve
  // se a visita atual realmente trouxe alguma coisa (reserva sem sessao);
  // trk sempre atualiza para o mais recente — e' a sessao que vai de fato
  // ate' o checkout.
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO leads (id, nome, email, whatsapp, origem, ip, user_agent, criado_em, atribuicao, trk)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(whatsapp) DO UPDATE SET
      nome = excluded.nome,
      email = excluded.email,
      origem = excluded.origem,
      atribuicao = COALESCE(excluded.atribuicao, leads.atribuicao),
      trk = COALESCE(excluded.trk, leads.trk)
  `).bind(id, nome, email, whatsapp, origem, ip, ua, quando, atribuicao, trk).run();

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE whatsapp = ?')
    .bind(whatsapp).first();

  // Evento de servidor pro Meta, em paralelo com a resposta — nao atrasa o
  // redirecionamento da pessoa pro checkout. event_id vem do navegador
  // (script.js gera um por envio) e e' o MESMO usado no fbq('track','Lead')
  // do Pixel, pra o Meta deduplicar as duas fontes do mesmo evento em vez
  // de contar duas vezes.
  context.waitUntil((async () => {
    try {
      const sessao = trk ? await env.DB.prepare('SELECT * FROM sessoes WHERE trk = ?').bind(trk).first() : null;
      const userData = await montarUserData({ lead, sessao });
      await enviarEventoMeta(env, {
        eventName: 'Lead',
        eventId: String(corpo?.event_id || crypto.randomUUID()),
        eventSourceUrl: String(corpo?.event_source_url || 'https://oimpulsoempresarial.com.br/'),
        userData,
        customData: origem ? { content_name: origem } : {},
      });
    } catch (e) {
      console.log('[lead] erro ao montar/enviar evento Meta', String(e));
    }
  })());

  return json({ ok: true, id: lead?.id }, 200, {
    'Set-Cookie': `${COOKIE_LEAD}=1; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
  });
}
