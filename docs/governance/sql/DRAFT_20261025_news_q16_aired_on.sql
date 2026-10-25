-- ============================================================
-- DRAFT_20261025_news_q16_aired_on.sql — NEWS-Q16 ■1 초안(중독뉴스 · 적용 0 · CTO/오너 판정 전 실행하지 말 것)
-- 내용:
--   1) articles.aired_on date NULL — 방송 편의 원 방송일(재업로드면 제목 · 설명에서 읽은 날 · 보통 편은 NULL)
--   2) 색인 articles(aired_on) WHERE aired_on IS NOT NULL
-- 지금(적용 전): 원 방송일은 published_at(= 원 방송일) · published_ts(비움) · raw_body 머리 「원 방송일: YYYY-MM-DD (재업로드 · …)」 줄에 둔다.
--   코드(backend/src/crawler/broadcast_aired.ts)는 이 열을 쓰지 않는다 — 적용하면 열 확인 뒤 쓰는 코드를 다음 판에 더한다.
-- 적용하면 채울 값(참고 · 이 초안은 UPDATE 를 하지 않음): raw_body 의 「원 방송일:」 줄
--   UPDATE public.articles SET aired_on = substring(raw_body from '원 방송일: (\d{4}-\d{2}-\d{2})')::date
--    WHERE source_type = 'broadcast' AND raw_body LIKE '%원 방송일:%' AND aired_on IS NULL;
-- 다시 실행해도 안전(IF NOT EXISTS · 기존 행 값 변경 0).
-- 되돌리기: DROP INDEX IF EXISTS public.articles_aired_on_idx; ALTER TABLE public.articles DROP COLUMN IF EXISTS aired_on;
-- ============================================================

BEGIN;

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS aired_on date NULL;
COMMENT ON COLUMN public.articles.aired_on IS
  'NEWS-Q16 original air date of a broadcast re-upload (read from title/description by rule, no LLM). NULL for normal uploads and articles.';

CREATE INDEX IF NOT EXISTS articles_aired_on_idx ON public.articles (aired_on) WHERE aired_on IS NOT NULL;

COMMIT;
