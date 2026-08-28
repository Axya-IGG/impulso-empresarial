import { json } from '../../_lib.js';

// Chegar aqui ja significa sessao valida: o _middleware barra o resto.
// O painel usa esta rota para decidir entre a tela de login e o conteudo.
export const onRequestGet = () => json({ ok: true });
