-- ============================================================
-- APPLY_20261010_news_bundle2.sql — NEWS-Q2 묶음 (중독뉴스 · Supabase 프로젝트 addiction-news)
-- 실행: 오너가 Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. 다시 실행해도 안전(IF NOT EXISTS · NULL 인 칸만 채움).
-- 내용:
--   1) articles.tier text NOT NULL DEFAULT 'publish' — 관문 두 층(■6). 기존 행은 전부 publish(= 지금처럼 보임).
--   2) articles.published_ts timestamptz NULL — 보도 시각(■7). 기존 행은 published_at 날짜의 KST 0시로 파생 채움.
--   3) articles.source_grade text NULL — 출처 등급 institution > academic > press > aggregator(■5). 기존 행은 종류·매체로 파생 채움.
--   4) articles.url_resolve jsonb NULL — 구글 링크 원문 해석 상태·시도 수·바꾸기 전 값(■3, 되돌리기용).
--   5) crawl_runs 표 — 수집 실행마다 한 행(■8): 소스별 읽음/후보/중복/호출/저장/보관/거절 · 피드 실패 · 비용 추정.
-- 코드는 열·표가 있는지 확인한 뒤에만 쓴다 — 적용 전에도 사이트·수집기는 옛 동작으로 돈다.
--   · 적용 뒤 다음 수집부터: 보관(archive) 저장 · 보도 시각 기록 · 기존 구글 링크 행 100건씩 원문 해석 · crawl_runs 기록.
--   · 웹 서비스는 다음 배포/재시작 때 열을 인식한다(보관 숨김 · ?tier=archive · published_ts 응답).
-- 되돌리기(필요할 때만, 오너 판단): 구글 링크 해석은 url_resolve->'prev' 값으로 되돌릴 수 있다.
--   열 제거: ALTER TABLE public.articles DROP COLUMN url_resolve, DROP COLUMN source_grade, DROP COLUMN published_ts, DROP COLUMN tier;
--   표 제거: DROP TABLE public.crawl_runs;
--
-- 묶음 판 번호 = 아래 BUNDLE BODY 줄들(시작·끝 표식 줄 제외, 줄끝 LF)의 sha256 앞 8자리.
-- ============================================================

-- BEGIN BUNDLE BODY
BEGIN;

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'publish';
COMMENT ON COLUMN public.articles.tier IS
  'NEWS-Q2 gate tier: publish (public lists) | archive (related but low confidence / incident; ?tier=archive only).';

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS published_ts timestamptz NULL;
COMMENT ON COLUMN public.articles.published_ts IS
  'NEWS-Q2 report time: feed timestamp (else crawl time). Older rows derived from published_at date at 00:00 KST.';

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source_grade text NULL;
COMMENT ON COLUMN public.articles.source_grade IS
  'NEWS-Q2 source grade: institution > academic > press > aggregator.';

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS url_resolve jsonb NULL;
COMMENT ON COLUMN public.articles.url_resolve IS
  'NEWS-Q2 Google News link resolution: {status ok|pending|failed, attempts, at, prev{source_url,source,outlet_id}}.';

UPDATE public.articles
   SET published_ts = (substring(published_at::text from 1 for 10)::date::timestamp AT TIME ZONE 'Asia/Seoul')
 WHERE published_ts IS NULL
   AND substring(published_at::text from 1 for 10) ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$';

UPDATE public.articles
   SET source_grade = CASE
         WHEN outlet_id IN ('who', 'drugfree') THEN 'institution'
         WHEN outlet_id = 'docdocdoc' THEN 'press'
         WHEN source_type = 'aggregator' THEN 'aggregator'
         ELSE 'press'
       END
 WHERE source_grade IS NULL;

CREATE TABLE IF NOT EXISTS public.crawl_runs (
  id bigserial PRIMARY KEY,
  field text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  read_only boolean NOT NULL DEFAULT false,
  sources_total int NOT NULL DEFAULT 0,
  feeds_ok int NOT NULL DEFAULT 0,
  feeds_failed int NOT NULL DEFAULT 0,
  failed_feeds jsonb NOT NULL DEFAULT '[]'::jsonb,
  items_seen int NOT NULL DEFAULT 0,
  candidates int NOT NULL DEFAULT 0,
  dup_skipped int NOT NULL DEFAULT 0,
  deepseek_calls int NOT NULL DEFAULT 0,
  deepseek_prompt_tokens bigint NOT NULL DEFAULT 0,
  deepseek_completion_tokens bigint NOT NULL DEFAULT 0,
  cost_usd_est numeric(12, 6) NOT NULL DEFAULT 0,
  saved int NOT NULL DEFAULT 0,
  archived int NOT NULL DEFAULT 0,
  rejected int NOT NULL DEFAULT 0,
  timed_out boolean NOT NULL DEFAULT false,
  per_source jsonb NULL,
  url_backfill jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crawl_runs_field_started_idx ON public.crawl_runs (field, started_at DESC);
COMMENT ON TABLE public.crawl_runs IS
  'NEWS-Q2 one row per crawler run (counts only, no secrets). GET /api/health shows the latest row.';

COMMIT;
-- END BUNDLE BODY

-- 확인표 (실행 결과 끝에 표시됨 · 모든 줄의 ok 열이 ok 여야 함)
SELECT * FROM (
  SELECT 1 AS n, 'bundle' AS item, 'fc15ba1b' AS value, 'ok' AS ok
  UNION ALL
  SELECT 2, 'articles.tier',
         COALESCE((SELECT data_type || ' default ' || column_default FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'tier'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'tier'
                      AND is_nullable = 'NO' AND column_default LIKE '''publish''%') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 3, 'articles.published_ts',
         COALESCE((SELECT data_type FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'published_ts'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'published_ts'
                      AND data_type = 'timestamp with time zone') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 4, 'articles.source_grade + url_resolve',
         (SELECT string_agg(column_name || ':' || data_type, ' ' ORDER BY column_name) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'articles' AND column_name IN ('source_grade', 'url_resolve')),
         CASE WHEN (SELECT count(*) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'articles' AND column_name IN ('source_grade', 'url_resolve')) = 2
              THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 5, 'table crawl_runs',
         CASE WHEN to_regclass('public.crawl_runs') IS NULL THEN 'missing' ELSE 'exists' END,
         CASE WHEN to_regclass('public.crawl_runs') IS NULL THEN 'FAIL' ELSE 'ok' END
  UNION ALL
  SELECT 6, 'derived published_ts (filled / date-like rows still NULL, expect 0)',
         (SELECT count(*) FILTER (WHERE published_ts IS NOT NULL)::text || ' / ' ||
                 count(*) FILTER (WHERE published_ts IS NULL AND published_at::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')::text
            FROM public.articles),
         CASE WHEN (SELECT count(*) FROM public.articles
           WHERE published_ts IS NULL AND published_at::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}') = 0 THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 7, 'derived source_grade (filled / still NULL, expect 0)',
         (SELECT count(*) FILTER (WHERE source_grade IS NOT NULL)::text || ' / ' ||
                 count(*) FILTER (WHERE source_grade IS NULL)::text FROM public.articles),
         CASE WHEN (SELECT count(*) FROM public.articles WHERE source_grade IS NULL) = 0 THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 8, 'tier counts (expect all publish right after apply)',
         (SELECT string_agg(tier || '=' || c, ' ' ORDER BY tier) FROM (SELECT tier, count(*) c FROM public.articles GROUP BY tier) x),
         CASE WHEN (SELECT count(*) FROM public.articles WHERE tier <> 'publish') = 0 THEN 'ok' ELSE 'FAIL' END
) t ORDER BY n;
