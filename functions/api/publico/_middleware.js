import { erro, tokenPublicoValido } from '../../_lib.js';

// Guarda tudo sob /api/publico/*. Diferente do /api/admin, aqui nao ha
// sessao: quem abre e o participante na fila do credenciamento e a equipe da
// casa que poe o telao no ar, e nenhum dos dois tem senha do painel. O que
// autoriza e o token longo que vem na propria URL (?k=), emitido no painel e
// revogavel de la.
//
// O papel sai do primeiro segmento depois de /api/publico/, para que o token
// do telao nao sirva para enviar cadastro e vice-versa.
const PAPEL_POR_ROTA = {
  credenciamento: 'credenciamento',
  sorteio: 'sorteio',
};

export async function onRequest(context) {
  const { request, env, next } = context;

  const rota = new URL(request.url).pathname.split('/')[3] || '';
  const papel = PAPEL_POR_ROTA[rota];
  if (!papel) return erro('Rota desconhecida.', 404);

  const k = new URL(request.url).searchParams.get('k');
  if (!(await tokenPublicoValido(env, papel, k))) {
    return erro('Link invalido ou revogado. Peca o endereco atualizado a organizacao.', 401);
  }

  const resposta = await next();
  // Mesma razao do painel: sao dados de pessoa, nao podem ficar parados num
  // cache de borda. E o telao precisa ler o estado novo a cada consulta.
  resposta.headers.set('Cache-Control', 'no-store');
  return resposta;
}
