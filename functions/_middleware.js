// Roda em toda requisicao ao site (Pages Functions middleware). Gera e
// mantem os identificadores de atribuicao na BORDA, nao no navegador — dois
// motivos:
//
//   1. Safari (ITP) apaga localStorage depois de alguns dias sem visita,
//      silenciosamente. Cookie de 400 dias setado aqui sobrevive a isso.
//   2. `trk` viaja ate' o checkout da Eduzz (campo tracker.code1) e volta
//      no webhook — casa a compra com o lead certo, sem bater e-mail ou
//      telefone e torcer para conferir.
//
// Decora o link de checkout via HTMLRewriter, direto no HTML de saida —
// elimina a classe de bug que ja pegou este projeto uma vez (uma funcao de
// captura em script.js que existia mas nunca era chamada a tempo: só
// apareceu testando com navegador real contra produção). Não tem como um
// `<a>` sair do servidor sem o `?trk=` se o middleware que o escreve nem
// depende de JS rodar.
import { agora } from './_lib.js';

const COOKIE_BASE = 'Path=/; Max-Age=34560000; SameSite=Lax; Secure'; // 400 dias

function lerCookies(request) {
  const cru = request.headers.get('Cookie') || '';
  const out = {};
  for (const parte of cru.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

// Extrai o parametro bruto da query string, sem o url-decode que
// `searchParams.get()` faria — o Meta espera o fbclid exatamente como veio
// na URL.
function paramBruto(search, nome) {
  const m = (search || '').match(new RegExp('[?&]' + nome + '=([^&]*)'));
  return m ? m[1] : '';
}

// oimpulsoempresarial.com.br: ETLD+1 de 3 rotulos (.com.br), indice 2 no
// formato fb.<indice>.<ts>.<valor> do Meta. Ver Meta Pixel SDK,
// sub-domain-index.
const SUB_DOMAIN_INDEX = 2;

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // So paginas: nunca mexe em /api/* (a Function de admin ja controla seu
  // proprio Cache-Control), nem em arquivo estatico (css/js/imagem/video),
  // nem no proprio /admin.
  const ehPagina =
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/admin') &&
    !/\.(css|js|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|woff2?|ttf|map|json|xml|txt)$/i.test(url.pathname);

  if (!ehPagina) return next();

  const cookies = lerCookies(request);
  let trk = cookies.trk || '';
  if (!trk) trk = crypto.randomUUID();

  const fbclid = paramBruto(url.search, 'fbclid');
  let fbc = cookies._fbc || '';
  if (fbclid && !fbc.endsWith('.' + fbclid)) {
    fbc = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${fbclid}`;
  }

  let fbp = cookies._fbp || '';
  if (!fbp) {
    fbp = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${Math.floor(1000000000 + Math.random() * 9000000000)}`;
  }

  const utm = {
    utm_source: url.searchParams.get('utm_source') || '',
    utm_medium: url.searchParams.get('utm_medium') || '',
    utm_campaign: url.searchParams.get('utm_campaign') || '',
    utm_content: url.searchParams.get('utm_content') || '',
    utm_term: url.searchParams.get('utm_term') || '',
  };
  const temUtmNovo = Object.values(utm).some(Boolean);

  // request.cf: geolocalizacao que o Cloudflare ja calcula por IP, em toda
  // requisicao — ninguem precisa digitar cidade/estado/CEP em formulario
  // nenhum para o Meta receber esse dado.
  const cf = request.cf || {};
  const ip = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';

  const resposta = await next();

  // Query string a anexar nos links de checkout: trk primeiro (e' o que
  // importa pro casamento exato), UTMs depois (a Eduzz devolve em data.utm,
  // reforco que ja usamos hoje).
  const qs = new URLSearchParams({ trk, ...Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) });
  const sufixo = '?' + qs.toString();

  const contentType = resposta.headers.get('content-type') || '';
  let respostaFinal = resposta;
  if (contentType.includes('text/html')) {
    respostaFinal = new HTMLRewriter()
      .on('a[data-checkout]', {
        element(el) {
          const href = el.getAttribute('href');
          if (href) el.setAttribute('href', href + sufixo);
        },
      })
      .transform(resposta);
  }

  const headers = new Headers(respostaFinal.headers);
  headers.append('Set-Cookie', `trk=${trk}; ${COOKIE_BASE}`);
  headers.append('Set-Cookie', `_fbp=${fbp}; ${COOKIE_BASE}`);
  if (fbc) headers.append('Set-Cookie', `_fbc=${fbc}; ${COOKIE_BASE}`);

  context.waitUntil((async () => {
    try {
      const quando = agora();
      const utmNovo = temUtmNovo ? 1 : 0; // D1 nao aceita boolean cru no bind
      await env.DB.prepare(`
        INSERT INTO sessoes (trk, fbp, fbc, ip, user_agent, cidade, estado, cep, pais,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trk) DO UPDATE SET
          fbp = excluded.fbp,
          fbc = CASE WHEN excluded.fbc != '' THEN excluded.fbc ELSE sessoes.fbc END,
          utm_source   = CASE WHEN ? THEN excluded.utm_source   ELSE sessoes.utm_source   END,
          utm_medium   = CASE WHEN ? THEN excluded.utm_medium   ELSE sessoes.utm_medium   END,
          utm_campaign = CASE WHEN ? THEN excluded.utm_campaign ELSE sessoes.utm_campaign END,
          utm_content  = CASE WHEN ? THEN excluded.utm_content  ELSE sessoes.utm_content  END,
          utm_term     = CASE WHEN ? THEN excluded.utm_term     ELSE sessoes.utm_term     END,
          atualizado_em = excluded.atualizado_em
      `).bind(
        trk, fbp, fbc, ip, userAgent,
        cf.city || null, cf.regionCode || cf.region || null, cf.postalCode || null, cf.country || null,
        utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term,
        quando, quando,
        utmNovo, utmNovo, utmNovo, utmNovo, utmNovo
      ).run();
    } catch (e) {
      console.log('[middleware] erro ao gravar sessao', String(e));
    }
  })());

  return new Response(respostaFinal.body, {
    status: respostaFinal.status,
    statusText: respostaFinal.statusText,
    headers,
  });
}
