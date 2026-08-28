-- Banco do Impulso Empresarial: leads captados na landing e a fila de
-- remarketing por WhatsApp. Aplicar com:
--   .\db.ps1 -Arquivo schema.sql            (producao)
--   .\db.ps1 -Arquivo schema.sql -Local     (banco local do wrangler dev)

-- ---------------------------------------------------------------- leads
-- O whatsapp e a identidade real do lead: e por ele que a Evolution envia,
-- e e nele que esta o UNIQUE. Guardamos normalizado em E.164 sem o '+'
-- (5512997205261) para que "(12) 99720-5261" e "+55 12 99720-5261" nao
-- virem dois leads e duas sequencias de mensagem para a mesma pessoa.
CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  whatsapp      TEXT NOT NULL,
  origem        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  criado_em     TEXT NOT NULL,
  optout        INTEGER NOT NULL DEFAULT 0,
  optout_em     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_whatsapp ON leads(whatsapp);
CREATE INDEX IF NOT EXISTS idx_leads_criado ON leads(criado_em);

-- ------------------------------------------------------------ mensagens
-- Dois tipos, porque os disparos tem naturezas diferentes:
--   'atraso' -> relativo a cada lead   (atraso_minutos apos o cadastro)
--   'data'   -> absoluto para a base   (enviar_em, uma vez so)
-- 'ativo' liga/desliga sem perder o historico; 'arquivado' tira da lista
-- principal sem apagar. Excluir de vez tambem e possivel pelo painel.
CREATE TABLE IF NOT EXISTS mensagens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo         TEXT NOT NULL,
  texto          TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('atraso','data')),
  atraso_minutos INTEGER,
  enviar_em      TEXT,
  ativo          INTEGER NOT NULL DEFAULT 1,
  arquivado      INTEGER NOT NULL DEFAULT 0,
  criado_em      TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL,
  -- Cada tipo so faz sentido com o seu proprio campo de agendamento.
  CHECK ((tipo = 'atraso' AND atraso_minutos IS NOT NULL)
      OR (tipo = 'data'   AND enviar_em IS NOT NULL))
);

-- --------------------------------------------------------------- envios
-- Log e trava de duplicidade ao mesmo tempo. O UNIQUE (lead_id, mensagem_id)
-- e o que garante que ninguem recebe a mesma mensagem duas vezes, mesmo se
-- o cron rodar sobreposto ou repetir apos uma falha parcial: a segunda
-- insercao viola o indice e o envio e descartado.
CREATE TABLE IF NOT EXISTS envios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      TEXT NOT NULL,
  mensagem_id  INTEGER NOT NULL,
  status       TEXT NOT NULL,
  detalhe      TEXT,
  enviado_em   TEXT NOT NULL,
  FOREIGN KEY (lead_id)     REFERENCES leads(id)     ON DELETE CASCADE,
  FOREIGN KEY (mensagem_id) REFERENCES mensagens(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_envios_unico ON envios(lead_id, mensagem_id);
CREATE INDEX IF NOT EXISTS idx_envios_data ON envios(enviado_em);

-- --------------------------------------------------- tentativas de login
-- O painel inteiro e protegido por uma senha unica compartilhada, entao
-- adivinha-la e a unica barreira entre a internet e os dados pessoais dos
-- leads. Sem trava, da para tentar milhoes de vezes. Registramos cada
-- tentativa e bloqueamos o IP apos algumas falhas seguidas.
CREATE TABLE IF NOT EXISTS tentativas_login (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip      TEXT NOT NULL,
  sucesso INTEGER NOT NULL,
  em      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tentativas ON tentativas_login(ip, em);
