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
    // O painel manda so o dia (AAAA-MM-DD), sem hora: a janela de envio e'
    // sempre 10h-20h em Brasilia nesse dia, para o disparo sair aos poucos
    // em vez de tudo de uma vez (ver worker-remarketing/src/index.js). Aqui
    // fixamos 10h porque enviar_em guarda o INICIO da janela — o worker
    // calcula o fim (+10h) na hora de montar a fila.
    const dia = String(corpo?.enviar_em || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return [null, 'Escolha o dia do envio.'];
    const d = new Date(`${dia}T10:00:00-03:00`);
    if (isNaN(d)) return [null, 'Data de envio inválida.'];

    // Dia passado deixaria a janela inteira (10h-20h) no passado, o que
    // torna todo mundo elegivel de uma vez so na proxima rodada do cron —
    // exatamente o disparo em massa que essa janela existe para evitar.
    const hojeBrasilia = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    const hojeISO = new Date(hojeBrasilia).toISOString().slice(0, 10);
    if (dia < hojeISO) return [null, 'Escolha uma data igual ou posterior a hoje.'];

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
