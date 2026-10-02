-- Consentimento separado para parceiros e patrocinadores (LGPD). Antes era um
-- aceite unico que ja incluia o contato dos patrocinadores; agora o cadastro
-- tem um checkbox opcional, desmarcado por padrao, so para isso.
--   1    = aceitou receber contato de parceiros/patrocinadores
--   0    = nao aceitou (nao pode ir na lista entregue a patrocinadores)
--   NULL = cadastro anterior a esta separacao, feito sob o texto antigo
ALTER TABLE leads ADD COLUMN aceite_parceiros INTEGER;
