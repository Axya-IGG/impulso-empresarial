-- Migracao 005 — UTM da compra, gravado na propria linha de `compras` no
-- momento em que o webhook da Eduzz confirma o pagamento, em vez de inferido
-- depois a partir do lead. Necessario porque leads.trk sempre aponta pra
-- sessao mais recente (functions/api/lead.js sobrescreve a cada nova
-- visita) — se a mesma pessoa voltar por um anuncio diferente antes de
-- comprar, o trk do lead ja nao e' mais o da sessao que gerou a venda.
-- Gravar no instante da compra congela a atribuicao certa pra sempre, mesmo
-- que o lead visite de novo depois.
-- Aplicar com: .\db.ps1 -Arquivo migrations\005_compras_utm.sql

ALTER TABLE compras ADD COLUMN utm_source   TEXT;
ALTER TABLE compras ADD COLUMN utm_medium   TEXT;
ALTER TABLE compras ADD COLUMN utm_campaign TEXT;
ALTER TABLE compras ADD COLUMN utm_content  TEXT;
ALTER TABLE compras ADD COLUMN utm_term     TEXT;

-- Backfill das compras aprovadas ja existentes: melhor esforco olhando o
-- trk/atribuicao do lead hoje. Pode ja nao ser mais exato se o lead visitou
-- de novo depois desta compra especifica, mas e' a unica informacao que
-- sobrou de antes desta migracao existir.
UPDATE compras SET
  utm_source = (
    SELECT COALESCE(s.utm_source, json_extract(l.atribuicao, '$.utm_source'))
    FROM leads l LEFT JOIN sessoes s ON s.trk = l.trk WHERE l.id = compras.lead_id
  ),
  utm_medium = (
    SELECT COALESCE(s.utm_medium, json_extract(l.atribuicao, '$.utm_medium'))
    FROM leads l LEFT JOIN sessoes s ON s.trk = l.trk WHERE l.id = compras.lead_id
  ),
  utm_campaign = (
    SELECT COALESCE(s.utm_campaign, json_extract(l.atribuicao, '$.utm_campaign'))
    FROM leads l LEFT JOIN sessoes s ON s.trk = l.trk WHERE l.id = compras.lead_id
  ),
  utm_content = (
    SELECT COALESCE(s.utm_content, json_extract(l.atribuicao, '$.utm_content'))
    FROM leads l LEFT JOIN sessoes s ON s.trk = l.trk WHERE l.id = compras.lead_id
  ),
  utm_term = (
    SELECT COALESCE(s.utm_term, json_extract(l.atribuicao, '$.utm_term'))
    FROM leads l LEFT JOIN sessoes s ON s.trk = l.trk WHERE l.id = compras.lead_id
  )
WHERE status = 'aprovada';
