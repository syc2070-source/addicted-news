-- ============================================================
-- APPLY_20261013_news_bundle3.sql — NEWS-Q3 묶음 (중독뉴스 · Supabase 프로젝트 addiction-news)
-- 실행: 오너가 Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. 다시 실행해도 안전(IF NOT EXISTS · 기존 행 값 변경 0).
--   복사 단추: GitHub 에서 이 파일을 열고 오른쪽 위 「Copy raw file」(겹친 네모 단추)를 누르면 전체가 복사된다
--   → SQL Editor 「New query」에 붙여 넣고 Run. 결과 끝 확인표의 ok 열이 모두 ok 이면 끝.
-- 내용:
--   1) articles.cluster_id text NULL — 사건 묶음 열쇠(묶음에서 가장 이른 보도의 id · 혼자면 자기 id) (■1·■4)
--   2) articles.cluster_size int NOT NULL DEFAULT 1 — 묶음 기사 수 (■1·■4)
--   3) 색인 articles(cluster_id) · articles(cluster_size) WHERE cluster_size > 1
--   4) crawl_runs.cluster_stats jsonb NULL — 실행마다 묶음 상속(관문 건너뜀)·되짚기 숫자 (■1 실측 절감 %)
-- 이 묶음은 기존 행 값을 바꾸지 않는다(새 열의 기본값만). 묶음 값은 수집기가 다음 실행부터 최근 30일을 채운다.
-- 코드는 열이 있는지 확인한 뒤에만 쓴다 — 적용 전에도 공개 API 는 응답 때 최근 7일을 묶어(10분 기억) 같은 화면을 보인다.
--   · 적용 뒤 다음 수집(12:00 KST)부터: 최근 30일 묶음 저장(cluster_id·cluster_size 두 열만) · crawl_runs.cluster_stats 기록.
--   · 웹 서비스는 다음 배포/재시작 때 열을 인식한다(저장된 묶음 사용 · 30일까지 접힘).
-- 되돌리기(필요할 때만, 오너 판단):
--   DROP INDEX IF EXISTS public.articles_cluster_size_multi_idx; DROP INDEX IF EXISTS public.articles_cluster_id_idx;
--   ALTER TABLE public.articles DROP COLUMN IF EXISTS cluster_size, DROP COLUMN IF EXISTS cluster_id;
--   ALTER TABLE public.crawl_runs DROP COLUMN IF EXISTS cluster_stats;
--
-- 묶음 판 번호 = 아래 BUNDLE BODY 줄들(시작·끝 표식 줄 제외, 줄끝 LF)의 sha256 앞 8자리.
-- ============================================================

-- BEGIN BUNDLE BODY
BEGIN;

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS cluster_id text NULL;
COMMENT ON COLUMN public.articles.cluster_id IS
  'NEWS-Q3 event cluster key: id of the earliest report in the cluster (own id when alone). Written by the crawler (last 30 days).';

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS cluster_size int NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.articles.cluster_size IS
  'NEWS-Q3 number of articles in the event cluster (1 = alone).';

CREATE INDEX IF NOT EXISTS articles_cluster_id_idx ON public.articles (cluster_id);
CREATE INDEX IF NOT EXISTS articles_cluster_size_multi_idx ON public.articles (cluster_size) WHERE cluster_size > 1;

ALTER TABLE public.crawl_runs ADD COLUMN IF NOT EXISTS cluster_stats jsonb NULL;
COMMENT ON COLUMN public.crawl_runs.cluster_stats IS
  'NEWS-Q3 per run: {poolLoaded, inherited, inheritedRejected, foreignSkipped, savedPct, backfill{rows,clusters,updated}}.';

COMMIT;
-- END BUNDLE BODY

-- 확인표 (실행 결과 끝에 표시됨 · 모든 줄의 ok 열이 ok 여야 함)
SELECT * FROM (
  SELECT 1 AS n, 'bundle' AS item, '3e49fa63' AS value, 'ok' AS ok
  UNION ALL
  SELECT 2, 'articles.cluster_id',
         COALESCE((SELECT data_type || ' nullable=' || is_nullable FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'cluster_id'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'cluster_id'
                      AND data_type = 'text') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 3, 'articles.cluster_size',
         COALESCE((SELECT data_type || ' default ' || column_default FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'cluster_size'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'cluster_size'
                      AND data_type = 'integer' AND is_nullable = 'NO' AND column_default = '1') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 4, 'indexes articles_cluster_id_idx + articles_cluster_size_multi_idx',
         (SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'articles'
             AND indexname IN ('articles_cluster_id_idx', 'articles_cluster_size_multi_idx')),
         CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'articles'
             AND indexname IN ('articles_cluster_id_idx', 'articles_cluster_size_multi_idx')) = 2 THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 5, 'crawl_runs.cluster_stats',
         COALESCE((SELECT data_type FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'crawl_runs' AND column_name = 'cluster_stats'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'crawl_runs' AND column_name = 'cluster_stats'
                      AND data_type = 'jsonb') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 6, 'cluster rows (with cluster_id / multi-member · 0 / 0 right after first apply)',
         (SELECT count(*) FILTER (WHERE cluster_id IS NOT NULL)::text || ' / ' ||
                 count(*) FILTER (WHERE cluster_size > 1)::text FROM public.articles),
         CASE WHEN (SELECT count(*) FROM public.articles WHERE cluster_size < 1) = 0 THEN 'ok' ELSE 'FAIL' END
) t ORDER BY n;
