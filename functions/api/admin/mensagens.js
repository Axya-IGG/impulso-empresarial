import { json, erro, agora } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const arquivadas = url.searchParams.get('arquivadas') === '1' ? 1 : 0;

  // Cada mensagem ja vem com quantos envios acumulou, para o painel mostrar
  // alcance sem uma segunda chamada por linha.
  const { results } = await env.DB.prepare(`
    SELECT m.*,
           (SELECT COUNT(*) FROM envios e WHERE e.mensagem_id = m.id AND e.status = 'enviado') AS enviados,
           (SELECT COUNT(*) FROM envios e WHERE e.mensagem_id = m.id AND e.status = 'erro')    AS erros
      FROM mensagens m
     WHERE m.arquivado = ?
     ORDER BY m.tipo, COALESCE(m.atraso_minutos, 0), m.enviar_em, m.id
  `).bind(arquivadas).all();

  return json({ mensagens: results || [] });
}

/** Valida e normaliza o corpo vindo do painel. Retorna [dados, mensagemDeErro]. */
export function validar(corpo) {
  const titulo = String(corpo?.titulo || '').trim();
  const texto = String(corpo?.texto || '').trim();
  const tipo = corpo?.tipo === 'data' ? 'data' : 'atraso';

  if (titulo.length < 2) return [null, 'Dê um título à mensagem.'];
  if (texto.length < 2) return [null, 'Escreva o texto da mensagem.'];
  if (texto.length > 3500) return [null, 'Texto muito longo (máximo 3500 caracteres).'];

  let atraso = null, enviarEm = null;

  if (tipo === 'atraso') {
    atraso = Number(corpo?.atraso_minutos);
    if (!Number.isFinite(atraso) || atraso < 0) return [null, 'Atraso inválido.'];
    atraso = Math.round(atraso);
  } else {
    const d = new Date(corpo?.enviar_em);
    if (isNaN(d)) return [null, 'Data de envio inválida.'];
    enviarEm = d.toISOString();
  }

  const publicosValidos = ['todos', 'compradores', 'nao_compradores'];
  const publico = publicosValidos.includes(corpo?.publico) ? corpo.publico : 'todos';

  return [{
    titulo, texto, tipo,
    atraso_minutos: atraso,
    enviar_em: enviarEm,
    ativo: corpo?.ativo === false ? 0 : 1,
    publico,
  }, null];
}

export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo invalido.'); }

  const [d, msgErro] = validar(corpo);
  if (msgErro) return erro(msgErro);

  const quando = agora();
  const r = await env.DB.prepare(`
    INSERT INTO mensagens (titulo, texto, tipo, atraso_minutos, enviar_em, ativo, publico, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(d.titulo, d.texto, d.tipo, d.atraso_minutos, d.enviar_em, d.ativo, d.publico, quando, quando).run();

  return json({ ok: true, id: r.meta.last_row_id });
}
