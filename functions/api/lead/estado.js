import { lerCookie } from '../../_lib.js';

/**
 * Diz pro front se quem esta acessando ja preencheu o formulario antes,
 * usando o cookie `trk` (edge, 400 dias — functions/_middleware.js) em vez
 * de confiar so' em localStorage/no cookie `impulso_lead` do navegador. Os
 * dois se perdem junto quando a pessoa limpa dados do site ou troca de
 * navegador/aparelho; o `trk` sobrevive mais tempo (e' o mesmo motivo pelo
 * qual o webhook da Eduzz casa compra com lead por ele em vez de e-mail/
 * telefone — ver functions/api/webhook/eduzz.js).
 *
 * So' devolve um boolean: esta rota e' publica (roda antes de qualquer
 * cadastro) e nao deve vazar nome/e-mail/whatsapp de ninguem so' por saber
 * o trk de alguem.
 */
export async function onRequestGet({ request, env }) {
  const trk = lerCookie(request, 'trk');
  let cadastrado = false;
  if (trk) {
    const lead = await env.DB.prepare('SELECT 1 FROM leads WHERE trk = ? LIMIT 1').bind(trk).first();
    cadastrado = !!lead;
  }
  return new Response(JSON.stringify({ cadastrado }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
