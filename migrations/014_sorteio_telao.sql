-- Uma chamada seguinte por sorteio.
--
-- A rechamada marca o ganhador como ausente e insere a chamada seguinte
-- apontando para ele em origem_id. Dois cliques simultaneos no mesmo botao
-- (ou o mesmo painel aberto em dois aparelhos) criavam DUAS linhas de "2a
-- chamada" para o mesmo premio, cada uma com um ganhador diferente — dois
-- nomes anunciados, um premio so'. A checagem em JS fecha o caso comum; este
-- indice fecha a corrida, porque o INSERT acontece dentro de um batch, que e'
-- transacao: a segunda tentativa falha inteira em vez de deixar o ausente
-- marcado sem substituto.
--
-- Parcial (WHERE origem_id IS NOT NULL) porque sorteio de primeira chamada
-- tem origem_id NULL e sao muitos — no SQLite varios NULL nao colidem num
-- UNIQUE comum, mas o indice parcial deixa a intencao explicita e menor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sorteios_origem
  ON sorteios(origem_id) WHERE origem_id IS NOT NULL;
