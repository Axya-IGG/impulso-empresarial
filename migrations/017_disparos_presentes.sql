-- Disparo para quem ESTEVE no evento (credenciamento.presente_em), como a
-- pesquisa de satisfacao pos-evento. Tabela propria em vez de `envios`
-- porque boa parte dos presentes nao e' lead (ingresso nominal, cadastro na
-- porta) e `envios.lead_id` aponta para `leads`.
--
-- Uma linha por (campanha, WhatsApp): duas pessoas com o mesmo numero
-- (ingresso comprado por alguem para a equipe) recebem UMA mensagem. O
-- UNIQUE e' a trava de duplicidade, igual ao de `envios`.
CREATE TABLE IF NOT EXISTS disparos_presentes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha    TEXT NOT NULL,
  whatsapp    TEXT NOT NULL,
  nomes       TEXT,
  status      TEXT NOT NULL,
  detalhe     TEXT,
  enviado_em  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_disparos_presentes_unico
  ON disparos_presentes(campanha, whatsapp);
CREATE INDEX IF NOT EXISTS idx_disparos_presentes_data
  ON disparos_presentes(enviado_em);
