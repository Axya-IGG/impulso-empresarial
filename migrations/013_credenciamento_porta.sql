-- Credenciamento de porta, e a separacao do que eu tinha juntado errado.
--
-- A ordem real do dia e: a pessoa chega, a equipe confere na lista de
-- compradores e marca presenca; so' entao ela recebe o link do formulario;
-- quem preenche entra no sorteio. Sao tres momentos distintos.
--
-- A tabela `participantes` (migration 011) e o terceiro momento — quem
-- respondeu o formulario — e continua sendo a unica fonte do sorteio.
-- Esta tabela aqui e o primeiro: quem comprou e quem entrou pela porta.

CREATE TABLE IF NOT EXISTS credenciamento (
  id              TEXT PRIMARY KEY,
  -- Comprador: 1 linha por lead com compra aprovada. UNIQUE para a
  -- sincronizacao poder rodar a cada abertura da aba sem duplicar ninguem.
  lead_id         TEXT UNIQUE,
  -- Acompanhante: quem chega junto de um comprador de ingresso multiplo
  -- ("Ate 3 Ingressos"). Aponta para a linha do comprador que o trouxe.
  anfitriao_id    TEXT REFERENCES credenciamento(id) ON DELETE CASCADE,
  -- Copiado do lead na sincronizacao, ou digitado para o acompanhante.
  nome            TEXT NOT NULL,
  whatsapp        TEXT,
  email           TEXT,
  produto         TEXT,
  presente_em     TEXT,            -- NULL = ainda nao chegou
  link_enviado_em TEXT,
  link_detalhe    TEXT,            -- erro do envio, quando falha
  criado_em       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credenciamento_presente ON credenciamento(presente_em);
CREATE INDEX IF NOT EXISTS idx_credenciamento_anfitriao ON credenciamento(anfitriao_id);

-- A pagina publica deixa de se chamar credenciamento e passa a ser o que ela
-- sempre foi: o formulario que a pessoa recebe DEPOIS de credenciada. O
-- token e o mesmo, so' muda a chave — assim o link ja distribuido continua
-- valendo e ninguem precisa recolher endereco de volta.
UPDATE config SET chave = 'token_formulario' WHERE chave = 'token_credenciamento';
