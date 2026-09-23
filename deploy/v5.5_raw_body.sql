-- LEARN-TRAIN-0: the owner applies this to the existing addicted-news database.
-- synchronize remains false. Existing rows stay NULL; no historical backfill.
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS raw_body text NULL;
COMMENT ON COLUMN public.articles.raw_body IS
  'Crawler source text retained before translation/summary, at most 6000 characters; may be RSS text rather than a complete article.';
