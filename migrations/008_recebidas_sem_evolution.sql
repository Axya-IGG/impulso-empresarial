-- O numero da Evolution saiu de uso: todo envio e toda resposta passam a
-- ser so' pela API oficial da Meta (ver worker-remarketing/src/index.js e
-- functions/api/webhook/meta-whatsapp.js). `canal` so' existia pra escolher
-- por qual das duas APIs responder — com uma so', a coluna nao guarda mais
-- informacao nenhuma.
ALTER TABLE mensagens_recebidas DROP COLUMN canal;
