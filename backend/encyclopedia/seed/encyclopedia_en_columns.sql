-- 중독백과 영어화: 영어 컬럼 추가 (term_en 은 이미 존재)
-- definition_en / example_en / body_en / advanced_en 추가.
-- 기존 한국어 컬럼(definition/example/body/advanced)은 그대로 둔다.
-- 실행: psql -h localhost -U postgres -d addiction_news -f backend/encyclopedia_en_columns.sql

ALTER TABLE encyclopedia_terms ADD COLUMN IF NOT EXISTS definition_en text DEFAULT '';
ALTER TABLE encyclopedia_terms ADD COLUMN IF NOT EXISTS example_en    text DEFAULT '';
ALTER TABLE encyclopedia_terms ADD COLUMN IF NOT EXISTS body_en       jsonb DEFAULT '[]'::jsonb;
ALTER TABLE encyclopedia_terms ADD COLUMN IF NOT EXISTS advanced_en   jsonb DEFAULT '[]'::jsonb;

-- 확인:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'encyclopedia_terms'
  AND column_name IN ('term_en','definition_en','example_en','body_en','advanced_en','definition','example','body','advanced')
ORDER BY column_name;
