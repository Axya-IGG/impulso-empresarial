import { json, erro, tokenPublico, regerarTokenPublico, CHAVES_PUBLICAS } from '../../_lib.js';

const CAMINHO = {
  credenciamento: '/credenciamento',
  sorteio: '/sorteio',
};

const montar = (origem, papel, token) => `${origem}${CAMINHO[papel]}?k=${token}`;

export async function onRequestGet(context) {
  const { request, env } = context;
  const origem = new URL(request.url).origin;

  const [cred, sort] = await Promise.all([
    tokenPublico(env, 'credenciamento'),
    tokenPublico(env, 'sorteio'),
  ]);

  return json({
    credenciamento: montar(origem, 'credenciamento', cred),
    sorteio: montar(origem, 'sorteio', sort),
  });
}

/** Troca o token de um dos papeis. O link anterior para de funcionar na hora
 *  — serve para quando o endereco vaza ou o evento acaba. */
export async function onRequestPost(context) {
  const { request, env } = context;

  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const papel = String(corpo?.papel ?? '');
  if (!CHAVES_PUBLICAS[papel]) return erro('Papel invalido.');

  const token = await regerarTokenPublico(env, papel);
  return json({ ok: true, link: montar(new URL(request.url).origin, papel, token) });
}
