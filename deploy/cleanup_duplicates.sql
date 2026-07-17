-- ============================================================
-- cleanup_duplicates.sql  (v5.2 #4)
-- 목적: 2026-07-17 크롤에서 매체별 제목 변형으로 중복 저장된
--       "강원랜드 AI 챗봇" 관련 기사 ~10건을 대표 1건만 남기고 정리.
--
-- ⚠️ 실행 금지 / 검토용. 반드시 아래 순서로 사람이 직접 확인 후 실행할 것.
--   1) STEP 1(미리보기 SELECT)로 삭제 대상 확인
--   2) 백업(pg_dump 또는 CSV export)
--   3) STEP 2를 BEGIN; ... ROLLBACK; 로 먼저 리허설
--   4) 이상 없으면 ROLLBACK → COMMIT 으로 교체 실행
--
-- 대표 선정 규칙(지시서): 전문매체 > 주요지(세계신문/국내지) > 포털/지방지
--   source_type: specialty(0) > world_press/kr_press(1) > aggregator(2)
--   동순위면 image_url 있는 것 > id 작은 것(먼저 저장) 우선.
-- ============================================================

-- 중복 그룹 판정 조건(강원랜드 + 챗봇/AI). 필요 시 문구 조정.
-- (여기서는 명시적 사건 그룹만 대상으로 좁혀 오삭제를 방지)

-- ─────────────────────────────────────────────
-- STEP 1) 미리보기: 어떤 행이 남고(keep) 어떤 행이 지워질지(delete) 확인
-- ─────────────────────────────────────────────
WITH grp AS (
  SELECT
    id, title, source, source_type, image_url, published_at, created_at,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE source_type
          WHEN 'specialty'   THEN 0
          WHEN 'world_press' THEN 1
          WHEN 'kr_press'    THEN 1
          WHEN 'aggregator'  THEN 2
          ELSE 3
        END ASC,
        (image_url IS NULL) ASC,   -- 이미지 있는 것 우선
        id ASC
    ) AS rn
  FROM articles
  WHERE title ILIKE '%강원랜드%'
    AND (title ILIKE '%챗봇%' OR title ILIKE '%AI%' OR title ILIKE '%인공지능%')
)
SELECT
  CASE WHEN rn = 1 THEN 'KEEP' ELSE 'DELETE' END AS action,
  id, source, source_type, (image_url IS NOT NULL) AS has_image, published_at, title
FROM grp
ORDER BY rn;

-- ─────────────────────────────────────────────
-- STEP 2) 실제 정리(대표 1건 제외 삭제). 위 미리보기 확인 후에만.
--   안전을 위해 트랜잭션으로 감쌌다. 먼저 ROLLBACK 리허설 → 이상 없으면 COMMIT.
-- ─────────────────────────────────────────────
-- BEGIN;
--
-- WITH grp AS (
--   SELECT
--     id,
--     ROW_NUMBER() OVER (
--       ORDER BY
--         CASE source_type
--           WHEN 'specialty'   THEN 0
--           WHEN 'world_press' THEN 1
--           WHEN 'kr_press'    THEN 1
--           WHEN 'aggregator'  THEN 2
--           ELSE 3
--         END ASC,
--         (image_url IS NULL) ASC,
--         id ASC
--     ) AS rn
--   FROM articles
--   WHERE title ILIKE '%강원랜드%'
--     AND (title ILIKE '%챗봇%' OR title ILIKE '%AI%' OR title ILIKE '%인공지능%')
-- )
-- DELETE FROM articles
-- WHERE id IN (SELECT id FROM grp WHERE rn > 1);
--
-- -- 삭제 건수 확인 후:
-- -- ROLLBACK;   -- 리허설
-- -- COMMIT;     -- 확정
