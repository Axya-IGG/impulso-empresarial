import { json, erro, tokenPublico, regerarTokenPublico, CHAVES_PUBLICAS } from '../../_lib.js';

const CAMINHO = {
  formulario: '/formulario',
  sorteio: '/sorteio',
  porta: '/porta',
  palco: '/palco',
};

const montar = (origem, papel, token) => `${origem}${CAMINHO[papel]}?k=${token}`;

export async function onRequestGet(context) {
  const { request, env } = context;
  const origem = new URL(request.url).origin;

  const [cred, sort, porta, palco] = await Promise.all([
    tokenPublico(env, 'formulario'),
    tokenPublico(env, 'sorteio'),
    tokenPublico(env, 'porta'),
    tokenPublico(env, 'palco'),
  ]);

  return json({
    formulario: montar(origem, 'formulario', cred),
    sorteio: montar(origem, 'sorteio', sort),
    porta: montar(origem, 'porta', porta),
    palco: montar(origem, 'palco', palco),
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
