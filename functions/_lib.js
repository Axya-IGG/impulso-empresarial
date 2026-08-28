// Helpers compartilhados pelas Pages Functions do Impulso Empresarial.

export const json = (dados, status = 200, extra = {}) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

export const erro = (mensagem, status = 400) => json({ erro: mensagem }, status);

export const agora = () => new Date().toISOString();

/**
 * Normaliza o telefone para E.164 sem o '+' (ex.: 5512997205261), que e o
 * formato que a Evolution espera e a chave de identidade do lead.
 *
 * O que chega do formulario e digitacao livre: "(12) 99720-5261",
 * "+55 12 99720 5261", "12997205261". Sem normalizar, a mesma pessoa
 * viraria varios leads e receberia a sequencia de mensagens repetida.
 *
 * Retorna null quando o numero nao fecha como celular brasileiro valido.
 */
export function normalizarWhatsapp(bruto) {
  let d = String(bruto || '').replace(/\D/g, '');

  // Tira o zero de tronco de quem digita "012 99720-5261".
  if (d.length > 11 && d.startsWith('0')) d = d.slice(1);

  // Sem DDI: 11 digitos (DDD + 9 + numero) ou 10 (fixo/celular antigo).
  if (d.length === 11 || d.length === 10) d = '55' + d;

  if (!d.startsWith('55') || d.length < 12 || d.length > 13) return null;

  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;

  // Celular brasileiro tem 9 na frente do numero. Numeros de 12 digitos
  // (sem o 9) sao aceitos e corrigidos: muita gente ainda digita assim.
  if (d.length === 12) d = d.slice(0, 4) + '9' + d.slice(4);

  if (d[4] !== '9') return null;
  return d;
}

export function emailValido(v) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v || '').trim());
}

export const ipDaRequisicao = (request) =>
  request.headers.get('CF-Connecting-IP') || '';

// ----------------------------------------------------------------- sessao
// A sessao do painel e um cookie assinado, sem tabela: o valor carrega o
// instante de expiracao e um HMAC dele. Serve porque a unica coisa que
// precisamos provar e "esta pessoa digitou a senha ha menos de N horas".

const enc = new TextEncoder();
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000;

async function chaveHmac(segredo) {
  return crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
}

const paraBase64Url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function assinar(valor, segredo) {
  const sig = await crypto.subtle.sign('HMAC', await chaveHmac(segredo), enc.encode(valor));
  return paraBase64Url(sig);
}

export async function criarSessao(segredo) {
  const exp = String(Date.now() + DURACAO_SESSAO_MS);
  return `${exp}.${await assinar(exp, segredo)}`;
}

export async function sessaoValida(token, segredo) {
  if (!token || !token.includes('.')) return false;
  const [exp, sig] = token.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;

  const esperado = await assinar(exp, segredo);
  // Comparacao de tempo constante: comparar com === vazaria, pelo tempo de
  // resposta, quantos caracteres da assinatura o atacante ja acertou.
  if (sig.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

export const NOME_COOKIE = 'impulso_sessao';

export function lerCookie(request, nome) {
  const cru = request.headers.get('Cookie') || '';
  for (const parte of cru.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
}

export const cookieSessao = (token) =>
  `${NOME_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DURACAO_SESSAO_MS / 1000}`;

export const cookieSessaoExpirado = () =>
  `${NOME_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

// -------------------------------------------------------------- Evolution
/**
 * Envia uma mensagem de texto pela Evolution API.
 * Retorna { ok, detalhe } — nunca lanca, para que uma falha num lead nao
 * derrube a rodada inteira do cron.
 */
export async function enviarWhatsapp(env, numero, texto) {
  const base = (env.EVOLUTION_URL || '').replace(/\/+$/, '');
  const instancia = env.EVOLUTION_INSTANCIA;
  try {
    const r = await fetch(`${base}/message/sendText/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.EVOLUTION_APIKEY },
      body: JSON.stringify({ number: numero, text: texto }),
    });
    const corpo = await r.text();
    return { ok: r.ok, detalhe: corpo.slice(0, 400) };
  } catch (e) {
    return { ok: false, detalhe: String(e).slice(0, 400) };
  }
}

/**
 * Troca {{nome}} e {{primeiro_nome}} pelos dados do lead.
 * Sem isso as mensagens ficam impessoais e o WhatsApp trata melhor
 * conversas que parecem escritas para a pessoa.
 */
export function renderizar(texto, lead) {
  const primeiro = String(lead.nome || '').trim().split(/\s+/)[0] || '';
  return String(texto)
    .replaceAll('{{nome}}', lead.nome || '')
    .replaceAll('{{primeiro_nome}}', primeiro);
}
