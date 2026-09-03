-- Migracao 004 — atribuicao capturada na borda (Cloudflare Function
-- _middleware.js), nao mais so' no navegador. Duas razoes:
--
--   1. Safari (ITP) apaga localStorage apos alguns dias de inatividade,
--      silenciosamente — sem isso ficar visivel em lugar nenhum, so'
--      degradando a qualidade de correspondencia pra quem usa iPhone.
--      Cookie de 400 dias setado pela borda sobrevive a isso.
--   2. Casar a compra da Eduzz com o lead batendo e-mail/telefone e'
--      probabilistico. O token `trk` (gerado na visita, mandado pra
--      Eduzz como `tracker.code1`, devolvido no webhook) casa exato.
--
-- Aplicar com: .\db.ps1 -Arquivo migrations\004_sessoes_trk.sql

-- Uma linha por sessao de navegador (cookie `trk`, 400 dias). Guarda tudo
-- que a borda consegue ver na primeira visita — inclusive geolocalizacao
-- do IP, que o Cloudflare ja calcula sozinho em toda requisicao
-- (`request.cf`), sem precisar perguntar nada pro visitante.
CREATE TABLE IF NOT EXISTS sessoes (
  trk           TEXT PRIMARY KEY,
  fbp           TEXT,
  fbc           TEXT,
  ip            TEXT,
  user_agent    TEXT,
  cidade        TEXT,
  estado        TEXT,
  cep           TEXT,
  pais          TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- trk do lead no momento do cadastro — se a mesma sessao (cookie) depois
-- comprar, o webhook acha o lead direto por aqui, sem precisar bater
-- e-mail/telefone. Fica NULL pra leads antigos (antes desta migracao) e
-- para quem bloqueia cookie; o casamento por whatsapp/e-mail continua
-- valendo como caminho de reserva.
ALTER TABLE leads ADD COLUMN trk TEXT;
