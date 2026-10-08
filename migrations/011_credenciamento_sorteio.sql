-- Credenciamento do dia do evento e o sorteio ao vivo.
--
-- Os participantes NAO entram em `leads`: lead e quem demonstrou interesse
-- pela landing (tem whatsapp, recebe remarketing, vira compra); participante
-- e quem respondeu o formulario no dia. Sao populacoes diferentes, com
-- campos diferentes, e misturar as duas sujaria as metricas de campanha.

CREATE TABLE IF NOT EXISTS participantes (
  id           TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  empresa      TEXT NOT NULL,
  cargo        TEXT NOT NULL,
  funcionarios TEXT NOT NULL,
  -- nome+empresa normalizados. UNIQUE porque quem abre o link duas vezes no
  -- celular nao pode acabar com duas chances no sorteio: o segundo envio
  -- atualiza o cadastro em vez de criar outro.
  chave        TEXT NOT NULL UNIQUE,
  origem       TEXT NOT NULL DEFAULT 'formulario',  -- 'formulario' | 'manual'
  criado_em    TEXT NOT NULL,
  ip           TEXT
);

CREATE INDEX IF NOT EXISTS idx_participantes_criado ON participantes(criado_em);

CREATE TABLE IF NOT EXISTS sorteios (
  id              TEXT PRIMARY KEY,
  titulo          TEXT NOT NULL,
  premio          TEXT,
  criado_em       TEXT NOT NULL,
  sorteado_em     TEXT,
  vencedor_id     TEXT REFERENCES participantes(id),
  -- Nome copiado para ca' no instante do sorteio, de proposito. A organizacao
  -- pode excluir um participante depois (inscricao errada, pessoa que foi
  -- embora); sem a copia, o historico do telao mostraria um premio sem dono.
  vencedor_nome    TEXT,
  vencedor_empresa TEXT,
  -- Congelados no instante do sorteio: se alguem se cadastrar depois, o
  -- registro do que foi sorteado nao pode mudar retroativamente.
  total_elegiveis INTEGER,
  posicao         INTEGER,
  verificacao     TEXT,
  -- 1 = quem ja ganhou concorre de novo. Fica por sorteio, e nao global,
  -- porque a escolha pode mudar entre um premio e outro.
  repescagem      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sorteios_criado ON sorteios(criado_em);

-- Chave/valor do painel. Hoje guarda so os tokens dos links publicos, que
-- precisam ser trocaveis sem mexer no SESSION_SECRET (trocar aquele
-- derrubaria a sessao de quem esta logado).
CREATE TABLE IF NOT EXISTS config (
  chave        TEXT PRIMARY KEY,
  valor        TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
