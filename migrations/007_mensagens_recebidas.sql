-- Guarda toda mensagem que um lead manda de volta pro WhatsApp, recebida
-- pelos dois webhooks (Evolution e API oficial da Meta). Ate aqui, os dois
-- so' olhavam pra "SAIR" e descartavam o resto - sem lugar nenhum pra ver
-- ou responder quem interage.
--
-- `canal` guarda por qual API a mensagem chegou, porque a resposta tem que
-- sair pela MESMA API: sao dois numeros diferentes, e o WhatsApp so' aceita
-- resposta a partir do numero certo pra continuar a mesma conversa.
CREATE TABLE IF NOT EXISTS mensagens_recebidas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      TEXT,
  whatsapp     TEXT NOT NULL,
  texto        TEXT NOT NULL,
  canal        TEXT NOT NULL CHECK (canal IN ('evolution','meta')),
  recebido_em  TEXT NOT NULL,
  lida         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_recebidas_recebido ON mensagens_recebidas(recebido_em);
CREATE INDEX IF NOT EXISTS idx_recebidas_lead ON mensagens_recebidas(lead_id);
