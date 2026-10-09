// Endereco proprio para o webhook dos ingressos (eventos blinket.*).
//
// A Eduzz nao deixa criar duas configuracoes de webhook com a mesma URL, e a
// de /api/webhook/eduzz ja e' a das faturas. O tratamento e' o mesmo: o
// handler de la separa ping, blinket.* e fatura pelo nome do evento.
export { onRequestGet, onRequestPost } from './eduzz.js';
