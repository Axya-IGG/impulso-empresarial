-- Rechamada: o ganhador nao esta na sala e precisa sair outro nome, agora.
--
-- A versao anterior obrigava a criar um sorteio novo na mao, digitando nome e
-- premio de novo. No palco isso e tempo morto com a plateia esperando. Agora
-- e um botao so': marca o ausente, abre a chamada seguinte com o mesmo premio
-- e ja sorteia.
--
-- O registro continua honesto justamente por nao sobrescrever nada — a
-- tentativa anterior fica no historico marcada como ausente, em vez de
-- sumir. "Sortear de novo ate dar certo" sem deixar rastro e o que tira a
-- credibilidade de um sorteio; deixar rastro resolve, e custa o mesmo clique.

-- 1 = o nome sorteado nao estava presente e o premio foi para a chamada
-- seguinte. O vencedor continua gravado: e ele que o telao risca na lista.
ALTER TABLE sorteios ADD COLUMN ausente INTEGER NOT NULL DEFAULT 0;

-- 1ª, 2ª, 3ª chamada do mesmo premio. Aparece no telao quando passa de 1,
-- para a plateia entender por que o nome mudou.
ALTER TABLE sorteios ADD COLUMN chamada INTEGER NOT NULL DEFAULT 1;

-- Aponta para a chamada anterior, encadeando as tentativas do mesmo premio.
ALTER TABLE sorteios ADD COLUMN origem_id TEXT;
