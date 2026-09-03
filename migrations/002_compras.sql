-- Migracao 002 — leads passam a poder ser "comprador" ou "nao-comprador",
-- pela integracao com a Eduzz (webhook) ou por lancamento manual no painel.
-- Aplicar com: .\db.ps1 -Arquivo migrations\002_compras.sql
--
-- Nao usa CREATE TABLE IF NOT EXISTS / ALTER com guarda condicional porque
-- D1 nao suporta "ADD COLUMN IF NOT EXISTS"; se for reaplicado por engano
-- num banco que ja tem essas mudancas, o erro de "duplicate column" avisa
-- na hora, o que e' o comportamento certo para uma migracao.

-- ---------------------------------------------------------------- compras
-- Separada de `leads` (em vez de um booleano solto) por dois motivos: uma
-- pessoa pode comprar mais de um lote, e reembolso/cancelamento precisa
-- mudar o status sem apagar o historico da venda original. "comprou" vira
-- EXISTS (SELECT 1 FROM compras WHERE lead_id = ? AND status = 'aprovada'),
-- do mesmo jeito que os cards de estatistica do painel ja somam `envios`
-- via subquery em vez de manter contador redundante em `leads`.
CREATE TABLE compras (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       TEXT NOT NULL,
  produto       TEXT,
  valor         REAL,
  status        TEXT NOT NULL CHECK (status IN ('aprovada','cancelada','reembolsada')),
  transacao_id  TEXT,              -- id da fatura na Eduzz; NULL quando lancada manualmente
  origem        TEXT NOT NULL DEFAULT 'eduzz' CHECK (origem IN ('eduzz','manual')),
  criado_em     TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
CREATE INDEX idx_compras_lead ON compras(lead_id);
-- Parcial: so trava duplicata em compras vindas da Eduzz (que tem
-- transacao_id). Idempotencia contra reentrega de webhook — a Eduzz pode
-- reenviar a mesma notificacao mais de uma vez se a resposta demorar.
CREATE UNIQUE INDEX idx_compras_transacao ON compras(transacao_id) WHERE transacao_id IS NOT NULL;

-- ------------------------------------------------------- mensagens.publico
-- Ate aqui toda mensagem valia para a base inteira. Precisa dar para mirar
-- em quem comprou (ex.: lembrete do evento) e em quem nao comprou (ex.:
-- reforco de oferta) separadamente. Filtro aplicado na hora do envio pelo
-- worker (WHERE, nao um valor congelado no agendamento) — se o lead comprar
-- entre o cadastro e o disparo, ele sai sozinho de uma mensagem de
-- "nao-comprador" sem precisar de nenhuma logica especial.
ALTER TABLE mensagens ADD COLUMN publico TEXT NOT NULL DEFAULT 'todos'
  CHECK (publico IN ('todos','compradores','nao_compradores'));
