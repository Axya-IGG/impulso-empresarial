import { erro, lerCookie, sessaoValida, NOME_COOKIE } from '../../_lib.js';

// Guarda tudo sob /api/admin/*. O login fica fora deste diretorio, em
// /api/login, justamente para nao cair aqui e se trancar do lado de fora.
export async function onRequest(context) {
  const { request, env, next } = context;

  if (!env.ADMIN_SENHA || !env.SESSION_SECRET) {
    return erro('Painel nao configurado: faltam os secrets ADMIN_SENHA e SESSION_SECRET.', 500);
  }

  const token = lerCookie(request, NOME_COOKIE);
  if (!(await sessaoValida(token, env.SESSION_SECRET))) {
    return erro('Sessao expirada ou ausente.', 401);
  }

  const resposta = await next();
  // Dados de lead nunca devem ficar em cache de borda ou de navegador.
  resposta.headers.set('Cache-Control', 'no-store');
  return resposta;
}
