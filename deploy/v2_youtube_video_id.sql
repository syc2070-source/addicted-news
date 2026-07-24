-- ============================================================
-- v2_youtube_video_id.sql  (중독백과 영상 v2 · 작업 3-1)
-- 목적: encyclopedia_terms 에 youtube_video_id 컬럼 추가.
--       유튜브 업로드 성공 시 upload_youtube.py 가 이 컬럼을 채우고,
--       백과 항목 페이지가 값이 있을 때만 유튜브 임베드를 표시한다.
--
-- 적용: Supabase SQL Editor 에서 1회 실행(멱등 — 이미 있으면 무시).
-- 롤백: ALTER TABLE encyclopedia_terms DROP COLUMN IF EXISTS youtube_video_id;
-- ============================================================
ALTER TABLE encyclopedia_terms
  ADD COLUMN IF NOT EXISTS youtube_video_id text;

-- (선택) 값이 있는 행 확인:
-- SELECT id, term_ko, youtube_video_id
--   FROM encyclopedia_terms
--  WHERE youtube_video_id IS NOT NULL;
