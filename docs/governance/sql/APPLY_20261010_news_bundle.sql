-- ============================================================
-- APPLY_20261010_news_bundle.sql — NEWS-Q1 묶음 (중독뉴스 · Supabase 프로젝트 addiction-news)
-- 실행: 오너가 Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. 다시 실행해도 안전(IF NOT EXISTS).
-- 내용:
--   1) articles.deleted_at timestamptz NULL  — soft 삭제(NEWS-Q1 ■1). 기존 행은 NULL(= 보임).
--   2) articles.kind text NOT NULL DEFAULT 'article' — 기사/방송 구분(■4).
--      방송 행(source_type='broadcast')만 kind='broadcast' 로 맞춤. 그 밖의 데이터 변경 없음.
-- 코드는 열이 있는지 확인한 뒤에만 새 열을 쓴다 — 적용 전에도 사이트·수집기는 옛 동작으로 돈다.
--   · 적용 뒤 judge_cleanup(주 1회 --apply)이 하드 삭제 대신 deleted_at 을 찍기 시작한다.
--   · 웹 서비스는 다음 배포/재시작 때 열을 인식해 deleted_at IS NOT NULL 기사를 숨긴다.
-- 되돌리기(필요할 때만, 오너 판단): ALTER TABLE public.articles DROP COLUMN kind; DROP COLUMN deleted_at;
--
-- 묶음 판 번호 = 아래 BUNDLE BODY 줄들(시작·끝 표식 줄 제외, 줄끝 LF)의 sha256 앞 8자리.
-- ============================================================

-- BEGIN BUNDLE BODY
BEGIN;

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
COMMENT ON COLUMN public.articles.deleted_at IS
  'NEWS-Q1 soft delete: set by judge_cleanup on a DeepSeek verdict; public API shows only NULL. Restore = set NULL.';

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'article';
COMMENT ON COLUMN public.articles.kind IS
  'NEWS-Q1 item kind: article | broadcast. Broadcast rows also carry source_type = broadcast.';

UPDATE public.articles SET kind = 'broadcast'
 WHERE source_type = 'broadcast' AND kind IS DISTINCT FROM 'broadcast';

COMMIT;
-- END BUNDLE BODY

-- 확인표 (실행 결과 끝에 표시됨 · 모든 줄의 ok 열이 ok 여야 함)
SELECT * FROM (
  SELECT 1 AS n, 'bundle' AS item, 'd775dc44' AS value, 'ok' AS ok
  UNION ALL
  SELECT 2, 'articles.deleted_at',
         COALESCE((SELECT data_type FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'deleted_at'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'deleted_at'
                      AND data_type = 'timestamp with time zone' AND is_nullable = 'YES') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 3, 'articles.kind',
         COALESCE((SELECT data_type || ' default ' || column_default FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'kind'), 'missing'),
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'kind'
                      AND is_nullable = 'NO' AND column_default LIKE '''article''%') THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 4, 'soft-deleted rows (expect 0 right after apply)',
         (SELECT count(*)::text FROM public.articles WHERE deleted_at IS NOT NULL), 'ok'
  UNION ALL
  SELECT 5, 'broadcast rows: source_type vs kind mismatch (expect 0)',
         (SELECT count(*)::text FROM public.articles
           WHERE (COALESCE(source_type, '') = 'broadcast') <> (kind = 'broadcast')),
         CASE WHEN (SELECT count(*) FROM public.articles
           WHERE (COALESCE(source_type, '') = 'broadcast') <> (kind = 'broadcast')) = 0 THEN 'ok' ELSE 'FAIL' END
) t ORDER BY n;
