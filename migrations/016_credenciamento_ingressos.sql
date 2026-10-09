-- Credenciamento passa a conhecer o INGRESSO nominal, nao so' a compra.
--
-- Os eventos blinket.attendance_* da Eduzz (migrations/015) trazem cada
-- participante com um codigo proprio, o inviteKey. E' ele que deixa a lista
-- da porta ser a de quem vai de fato: o comprador de "Ate 3 Ingressos" vira
-- tres linhas, uma por nome, cada uma ligada a ele por anfitriao_id.
--
-- ingresso_chave e' UNIQUE para o mesmo ingresso nunca virar duas linhas,
-- venha ele do webhook ou da planilha exportada da area de ingressos.

ALTER TABLE credenciamento ADD COLUMN ingresso_chave TEXT;
-- 'paid' ou 'canceled', como vem da Eduzz. Cancelado com presenca ja
-- marcada continua na lista (a pessoa esteve la'), mas sinalizado.
ALTER TABLE credenciamento ADD COLUMN ingresso_status TEXT;
-- Nome de quem pagou, para o ingresso que nao achou o comprador na lista
-- (compra que nao passou pelo webhook de faturas, por exemplo).
ALTER TABLE credenciamento ADD COLUMN comprador_nome TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credenciamento_ingresso
  ON credenciamento(ingresso_chave) WHERE ingresso_chave IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credenciamento_whatsapp ON credenciamento(whatsapp);
