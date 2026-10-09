// Certificados emitidos a partir do painel principal (aba Certificados).
//
// O app de certificados (C:\Claude Code\impulso-certificados, servido em
// certificados.oimpulsoempresarial.com.br) continua dono da arte, do editor
// de modelo, do PDF (/c/CODIGO.pdf) e da pagina de validacao do QR
// (/v/CODIGO). Aqui moram so' as tres coisas que a porta precisa: quem
// recebe (quem tem presenca no credenciamento), o codigo de cada um, e o
// envio pelo WhatsApp. As tabelas cert_* sao as do app, no mesmo banco.
//
// O codigo de autenticidade precisa sair IGUAL ao do app: la' a pagina
// publica confere o digito verificador com o mesmo CERT_SECRET antes de ir
// ao banco. gerarCodigo abaixo e' copia de impulso-certificados/functions/
// _codigo.js; mudar um sem o outro faz todo certificado novo dar "nao
// encontrado" na validacao.

import { agora, normalizarChave } from './_lib.js';

// ------------------------------------------------------- codigo (copia)
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const enc = new TextEncoder();

async function hmac(valor, segredo) {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', chave, enc.encode(valor)));
}

const paraSimbolos = (bytes, quantos) =>
  Array.from(bytes.slice(0, quantos), (b) => ALFABETO[b & 31]).join('');

export async function gerarCodigo(prefixo, segredo) {
  const sorteio = paraSimbolos(crypto.getRandomValues(new Uint8Array(6)), 6);
  const corpo = sorteio + paraSimbolos(await hmac(sorteio, segredo), 2);
  return `${prefixo}-${corpo.slice(0, 4)}-${corpo.slice(4)}`;
}

// ------------------------------------------------------------ nomes
// Particulas que ficam minusculas no meio do nome ("Maria da Silva").
const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'del', 'van', 'von']);

/**
 * "MARIA DA SILVA" e "maria da silva" -> "Maria da Silva".
 *
 * So' mexe em nome todo maiusculo ou todo minusculo, e em palavra solta
 * minuscula ("Luiz henrique"): quem digitou "McDonald" ou "d'Ávila" do jeito
 * certo nao pode ter o nome reescrito. O resultado vai para o certificado,
 * que e' o unico lugar onde o nome nao pode sair torto, e fica editavel na
 * aba antes do envio.
 */
export function formatarNome(bruto) {
  const nome = String(bruto || '').trim().replace(/\s+/g, ' ');
  if (!nome) return '';
  const tudoIgual = nome === nome.toUpperCase() || nome === nome.toLowerCase();

  return nome.split(' ').map((p, i) => {
    const minuscula = p.toLocaleLowerCase('pt-BR');
    if (i > 0 && PARTICULAS.has(minuscula)) return minuscula;
    if (!tudoIgual && p !== minuscula) return p;   // ja tem maiuscula: respeita
    return minuscula.replace(/(^|[-'’])(\p{L})/gu, (_, sep, l) => sep + l.toLocaleUpperCase('pt-BR'));
  }).join(' ');
}

/**
 * Nome que provavelmente nao e' de pessoa, ou esta incompleto. Nao bloqueia
 * nada: so' marca a linha para a equipe conferir antes de enviar.
 */
export function nomeSuspeito(nome) {
  const n = normalizarChave(nome);
  if (n.split(' ').length < 2) return 'só um nome';
  if (/\b(ltda|eireli|epp|me|ss|sa|cia|contabilidade|consultoria|assessoria|servicos|comercio|industria|associados|empresa|grupo)\b/.test(n)) {
    return 'parece empresa';
  }
  return null;
}

// --------------------------------------------------------- sincronizacao
/** Evento ativo do app de certificados e o modelo mais recente com arte. */
export async function eventoEModelo(env) {
  const evento = await env.DB.prepare(
    'SELECT * FROM cert_eventos WHERE ativo = 1 ORDER BY id DESC LIMIT 1'
  ).first();
  if (!evento) return { evento: null, modelo: null };
  const modelo = await env.DB.prepare(`
    SELECT m.id, m.nome FROM cert_modelos m
      JOIN cert_artes a ON a.modelo_id = m.id
     WHERE m.evento_id = ?
     ORDER BY m.atualizado_em DESC LIMIT 1
  `).bind(evento.id).first();
  return { evento, modelo };
}

/**
 * Deixa cert_participantes igual a quem tem presenca no credenciamento, e
 * emite o certificado de quem ainda nao tem.
 *
 * Roda a cada abertura da aba. Emitir aqui, e nao num botao, e' de
 * proposito: emitir e' so' sortear o codigo e gravar a linha (o PDF e'
 * montado na hora em que alguem abre o link), e com o codigo ja existindo o
 * "Baixar" de cada linha vira um link comum, sem passo intermediario.
 *
 * O nome do certificado nao e' sobrescrito depois de criado: a equipe pode
 * ter corrigido na aba, e o credenciamento nao tem como saber disso.
 */
export async function sincronizarCertificados(env) {
  const { evento, modelo } = await eventoEModelo(env);
  if (!evento) return { erro: 'Nenhum evento ativo no app de certificados.' };

  const quando = agora();

  // 1. Quem chegou e ainda nao esta na lista de certificados.
  const { results: novos } = await env.DB.prepare(`
    SELECT k.id, k.nome, k.whatsapp, k.email, k.lead_id, k.presente_em
      FROM credenciamento k
     WHERE k.presente_em IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM cert_participantes p
                        WHERE p.evento_id = ? AND p.credenciamento_id = k.id)
  `).bind(evento.id).all();

  if (novos?.length) {
    await env.DB.batch(novos.map(k => {
      const nome = formatarNome(k.nome);
      return env.DB.prepare(`
        INSERT INTO cert_participantes
          (id, evento_id, nome, nome_busca, email, whatsapp, lead_id, origem,
           presente, presente_em, credenciamento_id, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'credenciamento', 1, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `).bind(crypto.randomUUID(), evento.id, nome, normalizarChave(nome), k.email || null,
        k.whatsapp || null, k.lead_id || null, k.presente_em, k.id, quando, quando);
    }));
  }

  // 2. Presenca e contato acompanham o credenciamento (presenca desfeita
  //    na porta, WhatsApp corrigido, linha excluida).
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE cert_participantes
         SET presente = CASE WHEN k.presente_em IS NULL THEN 0 ELSE 1 END,
             presente_em = k.presente_em,
             whatsapp = COALESCE(k.whatsapp, cert_participantes.whatsapp),
             email = COALESCE(k.email, cert_participantes.email),
             atualizado_em = ?
        FROM credenciamento k
       WHERE k.id = cert_participantes.credenciamento_id
         AND cert_participantes.evento_id = ?
         AND (cert_participantes.presente != (k.presente_em IS NOT NULL)
              OR cert_participantes.whatsapp IS NOT k.whatsapp
              OR (k.email IS NOT NULL AND cert_participantes.email IS NOT k.email))
    `).bind(quando, evento.id),
    // Linha apagada do credenciamento (acompanhante removido) deixa de ter
    // presenca aqui.
    env.DB.prepare(`
      UPDATE cert_participantes SET presente = 0, atualizado_em = ?
       WHERE evento_id = ? AND credenciamento_id IS NOT NULL AND presente = 1
         AND NOT EXISTS (SELECT 1 FROM credenciamento k WHERE k.id = cert_participantes.credenciamento_id)
    `).bind(quando, evento.id),
    // Certificado de quem perdeu a presenca e nunca recebeu nem baixou: sai.
    // Ninguem tem o codigo, entao nao ha o que revogar. Se ja saiu, fica, e
    // a aba mostra a linha como "sem presença" para a equipe decidir.
    env.DB.prepare(`
      DELETE FROM cert_certificados
       WHERE baixas = 0
         AND participante_id IN (SELECT id FROM cert_participantes WHERE evento_id = ? AND presente = 0)
         AND NOT EXISTS (SELECT 1 FROM cert_entregas e
                          WHERE e.certificado_id = cert_certificados.id
                            AND e.status IN ('enviado','enviando','falha'))
    `).bind(evento.id),
  ]);

  // 3. Emite para os presentes sem certificado.
  let emitidos = 0;
  if (modelo && env.CERT_SECRET) {
    const { results: semCert } = await env.DB.prepare(`
      SELECT p.id FROM cert_participantes p
        LEFT JOIN cert_certificados c ON c.participante_id = p.id
       WHERE p.evento_id = ? AND p.presente = 1 AND c.id IS NULL
    `).bind(evento.id).all();

    for (const p of semCert || []) {
      // Ate 5 tentativas por colisao do UNIQUE do codigo (praticamente nunca).
      for (let t = 0; t < 5; t++) {
        try {
          await env.DB.prepare(`
            INSERT INTO cert_certificados (participante_id, modelo_id, codigo, emitido_em)
            VALUES (?, ?, ?, ?)
          `).bind(p.id, modelo.id, await gerarCodigo(evento.prefixo, env.CERT_SECRET), quando).run();
          emitidos++;
          break;
        } catch (e) {
          const msg = String(e?.message || '');
          if (msg.includes('cert_certificados.participante_id')) break;   // outra aba emitiu
          if (!msg.includes('cert_certificados.codigo')) throw e;
        }
      }
    }
  }

  return { evento, modelo, emitidos };
}

// ---------------------------------------------------------------- envio
// Mesmas variacoes do worker de entrega do app (worker-envio/src/index.js):
// texto identico em massa e' um dos sinais que derrubam numero na API nao
// oficial, e os dois caminhos saem do mesmo numero.
const MENSAGEM = `Oi, {{primeiro_nome}}! Seu certificado de participação no {{evento}} está aqui. 🎉

Pode validar a autenticidade dele em {{link}}
---
{{primeiro_nome}}, obrigado por participar do {{evento}}! Segue o seu certificado de participação.

Para conferir que ele é autêntico: {{link}}
---
Olá, {{primeiro_nome}}! Aqui está o seu certificado do {{evento}}. Foi muito bom ter você com a gente.

Autenticidade em {{link}}`;

export const urlCertificados = (env) =>
  String(env.CERT_URL || 'https://certificados.oimpulsoempresarial.com.br').replace(/\/+$/, '');

export function legendaCertificado({ nome, evento, link }) {
  const partes = MENSAGEM.split(/\r?\n-{3,}\r?\n/);
  const texto = partes[Math.floor(Math.random() * partes.length)];
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  return texto
    .replaceAll('{{primeiro_nome}}', primeiro)
    .replaceAll('{{evento}}', String(evento || ''))
    .replaceAll('{{link}}', String(link || ''));
}

/** PDF como documento no WhatsApp: a Evolution baixa da URL e anexa. */
export async function enviarDocumentoWhatsapp(env, { numero, url, nomeArquivo, legenda }) {
  const base = (env.EVOLUTION_URL || '').replace(/\/+$/, '');
  try {
    const r = await fetch(`${base}/message/sendMedia/${env.EVOLUTION_INSTANCIA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.EVOLUTION_APIKEY },
      body: JSON.stringify({
        number: numero,
        mediatype: 'document',
        mimetype: 'application/pdf',
        media: url,
        fileName: nomeArquivo,
        caption: legenda,
      }),
      // A Evolution baixa o PDF antes de responder; 25 s cobre a geracao
      // do certificado do lado de la' sem prender o painel para sempre.
      signal: AbortSignal.timeout(25000),
    });
    const corpo = await r.text();
    return { ok: r.ok, detalhe: corpo.slice(0, 400) };
  } catch (e) {
    return { ok: false, detalhe: String(e).slice(0, 400) };
  }
}
