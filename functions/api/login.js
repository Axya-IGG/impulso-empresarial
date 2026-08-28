import {
  json, erro, agora, ipDaRequisicao,
  criarSessao, cookieSessao, cookieSessaoExpirado,
} from '../_lib.js';

const JANELA_MIN = 15;
const MAX_FALHAS = 8;

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_SENHA || !env.SESSION_SECRET) {
    return erro('Painel nao configurado: faltam os secrets ADMIN_SENHA e SESSION_SECRET.', 500);
  }

  const ip = ipDaRequisicao(request);
  const desde = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();

  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM tentativas_login WHERE ip = ? AND sucesso = 0 AND em > ?'
  ).bind(ip, desde).all();

  if ((results?.[0]?.n ?? 0) >= MAX_FALHAS) {
    return erro(`Muitas tentativas. Aguarde ${JANELA_MIN} minutos.`, 429);
  }

  let senha = '';
  try { senha = (await request.json())?.senha ?? ''; } catch { /* corpo invalido = senha vazia */ }

  const ok = senha === env.ADMIN_SENHA;
  await env.DB.prepare(
    'INSERT INTO tentativas_login (ip, sucesso, em) VALUES (?, ?, ?)'
  ).bind(ip, ok ? 1 : 0, agora()).run();

  if (!ok) return erro('Senha incorreta.', 401);

  return json({ ok: true }, 200, {
    'Set-Cookie': cookieSessao(await criarSessao(env.SESSION_SECRET)),
  });
}

export async function onRequestDelete() {
  return json({ ok: true }, 200, { 'Set-Cookie': cookieSessaoExpirado() });
}
