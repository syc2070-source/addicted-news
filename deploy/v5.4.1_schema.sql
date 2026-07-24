-- v5.4.1 스키마 — Supabase 에 1회 적용.
-- 1) rejected_articles 도메인 컬럼(자동 블랙리스트 집계용)
ALTER TABLE rejected_articles ADD COLUMN IF NOT EXISTS domain varchar(200);
-- 2) crawl_daily(한국비중 3일 추적) — 크롤러가 자동 생성하지만 명시 적용도 가능
CREATE TABLE IF NOT EXISTS crawl_daily (
  day date PRIMARY KEY, kr_ratio real, total int, created_at timestamp DEFAULT now()
);
-- 롤백: ALTER TABLE rejected_articles DROP COLUMN IF EXISTS domain; DROP TABLE IF EXISTS crawl_daily;
