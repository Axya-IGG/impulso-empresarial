import { json, erro, normalizarChave } from '../../_lib.js';
import { aplicarIngresso, ingressoDaPlanilha } from '../../_ingressos.js';

/**
 * Importa a planilha "Lista de presença" da area de ingressos da Eduzz.
 *
 * Existe porque o webhook dos ingressos so' avisa o que acontece depois de
 * configurado (09/10/2026): quem ja tinha ingresso chega por aqui. Pode ser
 * importada de novo quantas vezes quiser (a chave e' o Nº do ingresso), o
 * que serve para a manha do evento, quando empresas atribuem ingressos sem
 * nome em cima da hora.
 *
 * O painel le o arquivo no navegador e manda as linhas ja com os campos
 * pelo nome do cabecalho (ver importarPlanilhaIngressos em admin.js).
 */
const MAX_LINHAS = 1000;

// Compra de teste da equipe ("Teste Teste Teste") nao entra na porta.
const ehTeste = (nome) => /^(teste\s*)+$/.test(normalizarChave(nome));

export async function onRequestPost({ request, env }) {
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }

  const linhas = Array.isArray(corpo?.linhas) ? corpo.linhas.slice(0, MAX_LINHAS) : [];
  if (!linhas.length) return erro('A planilha não tem nenhuma linha de participante.');

  const resumo = {};
  const ignorados = [];
  for (const l of linhas) {
    const ing = ingressoDaPlanilha(l || {});
    if (ehTeste(ing.nome)) { ignorados.push(ing.nome); continue; }
    const acao = await aplicarIngresso(env, ing, { tipo: ing.status === 'canceled' ? 'cancelado' : 'atualizado' });
    resumo[acao] = (resumo[acao] || 0) + 1;
  }

  return json({ ok: true, total: linhas.length, resumo, ignorados });
}
