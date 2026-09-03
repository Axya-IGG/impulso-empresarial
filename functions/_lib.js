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
 * Mensagens podem trazer variações de texto separadas por uma linha só com
 * "---", para não mandar o mesmo texto idêntico pra todo mundo — texto
 * idêntico em massa é um dos sinais que fazem o WhatsApp suspeitar de
 * automação numa API não-oficial. Sorteia uma variação por envio; sem
 * separador, o texto inteiro é a única variação (comportamento de sempre).
 */
export function escolherVariante(texto) {
  const partes = String(texto || '').split(/\r?\n-{3,}\r?\n/).map(p => p.trim()).filter(Boolean);
  if (partes.length <= 1) return String(texto || '');
  return partes[Math.floor(Math.random() * partes.length)];
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

// -------------------------------------------------------- Meta Conversions API
// Compartilhado por functions/api/lead.js (evento Lead) e
// functions/api/webhook/eduzz.js (evento Purchase) — os dois precisam do
// mesmo hash, do mesmo envio pro Graph API, e do mesmo user_data enriquecido
// por lead + sessão. Ver a skill `meta-capi-tracking` (Skill tool) para o
// desenho completo e como replicar isto em outro projeto.

export async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * fn/ln: o Meta quer nome e sobrenome separados, e o formulário só pede um
 * campo "nome". Heurística padrão de mercado — primeira palavra é o nome,
 * o resto é o sobrenome; imperfeita pra nome composto, mas é o que a
 * maioria das integrações faz (inclusive a Meta não documenta nada melhor).
 */
export function separarNome(nomeCompleto) {
  const partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  return { fn: partes[0] || '', ln: partes.slice(1).join(' ') };
}

/**
 * Normalização best-effort pra ct/st/zp/country, seguindo a orientação geral
 * do Meta (minúsculo, sem espaço, sem pontuação) — a doc oficial não detalha
 * regra própria pra cada país. Se um dia notar que cidade/estado não está
 * ajudando a qualidade de correspondência, esta é a função a revisar
 * primeiro contra o guia de hash mais atual do Meta.
 */
export function normalizarTextoMeta(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento (ã -> a~ -> a)
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Monta o user_data do Meta CAPI a partir de uma linha de `leads` e (se
 * achada) a `sessoes` correspondente pelo `trk`. `sessao` tem prioridade
 * pros campos que ela cobre (fbp/fbc/ip/user_agent/geo) — foi capturada na
 * borda (functions/_middleware.js), mais confiável do que o que o
 * navegador reportou no corpo de um POST.
 */
export async function montarUserData({ lead, sessao }) {
  const userData = {};

  if (lead?.email) userData.em = [await sha256Hex(String(lead.email).trim().toLowerCase())];
  if (lead?.whatsapp) userData.ph = [await sha256Hex(lead.whatsapp)]; // ja' E.164 sem '+'

  const { fn, ln } = separarNome(lead?.nome);
  if (fn) userData.fn = [await sha256Hex(normalizarTextoMeta(fn))];
  if (ln) userData.ln = [await sha256Hex(normalizarTextoMeta(ln))];

  const trk = lead?.trk || sessao?.trk;
  if (trk) userData.external_id = [await sha256Hex(trk)];

  if (sessao?.fbp) userData.fbp = sessao.fbp;
  if (sessao?.fbc) userData.fbc = sessao.fbc;

  const ip = sessao?.ip || lead?.ip;
  const ua = sessao?.user_agent || lead?.user_agent;
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;

  if (sessao?.cidade) userData.ct = [await sha256Hex(normalizarTextoMeta(sessao.cidade))];
  if (sessao?.estado) userData.st = [await sha256Hex(normalizarTextoMeta(sessao.estado))];
  if (sessao?.cep)    userData.zp = [await sha256Hex(normalizarTextoMeta(sessao.cep))];
  if (sessao?.pais)   userData.country = [await sha256Hex(normalizarTextoMeta(sessao.pais))];

  return userData;
}

/**
 * Dispara um evento pro Meta Conversions API. Nunca lança — uma falha aqui
 * não pode derrubar o fluxo que a chamou (cadastro do lead, registro da
 * compra). test_event_code (env.META_TEST_EVENT_CODE) só deve existir
 * enquanto alguém estiver testando pelo "Testar Eventos" do Gerenciador —
 * se ficar setada em uso normal, todo evento real vira teste pra sempre e
 * some da otimização das campanhas.
 */
export async function enviarEventoMeta(env, { eventName, eventId, eventTime, eventSourceUrl, userData, customData, actionSource = 'website' }) {
  if (!env.META_CAPI_TOKEN || !env.META_PIXEL_ID) {
    console.log(`[meta-capi] ${eventName} nao configurado (falta token ou pixel id)`);
    return;
  }

  const evento = {
    event_name: eventName,
    event_time: eventTime ?? Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: actionSource,
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: customData,
  };

  const corpoEnvio = { data: [evento] };
  if (env.META_TEST_EVENT_CODE) corpoEnvio.test_event_code = env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoEnvio) }
    );
    const corpo = await r.text();
    console.log(`[meta-capi] ${eventName}`, r.status, corpo.slice(0, 500));
  } catch (e) {
    console.log(`[meta-capi] ${eventName} erro de rede`, String(e));
  }
}
