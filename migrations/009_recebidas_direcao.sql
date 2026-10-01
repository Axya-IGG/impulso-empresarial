-- Ate aqui a caixa de entrada so' mostrava quem respondeu: `mensagens_recebidas`
-- guardava so' mensagem que o lead mandou pra gente. Virou o log das duas
-- direcoes, pra conversa aparecer na lista assim que a gente manda a
-- primeira mensagem (confirmacao de compra, reenvio manual, resposta do
-- operador), do jeito que o WhatsApp Web mostra toda conversa que voce
-- comeca, nao so' quem te responde. Linha antiga fica 'entrada' pelo
-- default, que e' o que ela sempre foi.
ALTER TABLE mensagens_recebidas ADD COLUMN direcao TEXT NOT NULL DEFAULT 'entrada';

-- Agrupar por contato (uma linha por conversa na lista) precisa filtrar por
-- whatsapp o tempo todo; sem indice, essa consulta varre a tabela inteira a
-- cada carregamento do painel.
CREATE INDEX IF NOT EXISTS idx_recebidas_whatsapp ON mensagens_recebidas(whatsapp);
