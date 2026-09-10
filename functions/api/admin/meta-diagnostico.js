import { json, erro } from '../../_lib.js';

/**
 * Diagnostico do META_CAPI_TOKEN. Sem `?test_event_code=`, so' tenta ler o
 * proprio objeto do pixel (GET /{pixel-id}) — nao manda evento nenhum, mas
 * um token gerado so' pra CAPI costuma NAO ter permissao nem pra esse GET
 * (e' esperado dar "Missing Permission" mesmo com o token bom pra enviar
 * evento de verdade; isso sozinho nao prova nada).
 *
 * Com `?test_event_code=TEST12345` (Gerenciador de Eventos → Pixel →
 * "Testar eventos"), manda um evento de Purchase de mentira pro endpoint
 * real (/{pixel-id}/events) usando esse codigo — aparece so' na aba de
 * teste do Meta, nunca conta como conversao de verdade nem polui
 * otimizacao de campanha. E' o unico jeito confiavel de confirmar que o
 * token consegue mandar evento, ja' que o Graph API tem permissao separada
 * por endpoint.
 */
export async function onRequestGet({ request, env }) {
  if (!env.META_CAPI_TOKEN || !env.META_PIXEL_ID) {
    return erro('Faltam META_CAPI_TOKEN ou META_PIXEL_ID.', 500);
  }

  const testEventCode = new URL(request.url).searchParams.get('test_event_code');

  if (!testEventCode) {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}?fields=id&access_token=${env.META_CAPI_TOKEN}`
    );
    const corpo = await r.json().catch(() => ({}));
    return json({ teste: 'leitura-do-pixel', status_facebook: r.status, resposta: corpo });
  }

  const evento = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: `diagnostico-${crypto.randomUUID()}`,
    action_source: 'website',
    event_source_url: 'https://oimpulsoempresarial.com.br/',
    user_data: {
      // Hash de um e-mail de mentira: o campo e' obrigatorio pra o evento
      // ser aceito, mas nao precisa corresponder a ninguem de verdade —
      // com test_event_code o Meta nao tenta casar esse evento com pessoa
      // nenhuma.
      em: [await sha256Hex('diagnostico@oimpulsoempresarial.com.br')],
    },
    custom_data: { currency: 'BRL', value: 97 },
  };

  const r = await fetch(
    `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evento], test_event_code: testEventCode }),
    }
  );
  const corpo = await r.json().catch(() => ({}));
  return json({ teste: 'envio-de-evento', status_facebook: r.status, resposta: corpo });
}

async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto.trim().toLowerCase()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
