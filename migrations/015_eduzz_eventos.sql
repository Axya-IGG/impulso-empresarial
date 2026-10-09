-- Log cru dos eventos de ingresso da Eduzz (Blinket), 09/10/2026.
--
-- A lista da porta saia das COMPRAS, e compra nao e' participante: quem
-- compra "Ate 3 Ingressos" e' uma pessoa so' na Eduzz e tres na sala, e o
-- comprador nem sempre vai. Os eventos blinket.attendance_* trazem cada
-- ingresso nominal, que e' a lista fiel. Em 09/10 havia 90 compras e 97
-- participantes na area de ingressos.
--
-- O formato desses eventos nao estava documentado nem capturado ainda, por
-- isso entram primeiro aqui, inteiros, antes de virarem linha do
-- credenciamento. assinatura_ok guarda se o x-signature bateu com o
-- EDUZZ_WEBHOOK_SECRET: o evento e' gravado de qualquer jeito (a Eduzz
-- trata resposta diferente de 2xx como erro na configuracao), mas so' o
-- assinado pode alimentar a lista.
CREATE TABLE IF NOT EXISTS eduzz_eventos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evento        TEXT,
  assinatura_ok INTEGER NOT NULL DEFAULT 0,
  corpo         TEXT NOT NULL,
  recebido_em   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eduzz_eventos_evento ON eduzz_eventos(evento, recebido_em);
