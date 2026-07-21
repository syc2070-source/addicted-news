-- v5.4 (작업2) — 입구 게이트 거부 기사 격리(하드 삭제 금지). 보존 90일.
CREATE TABLE IF NOT EXISTS rejected_articles (
  id             SERIAL PRIMARY KEY,
  title          varchar(500) NOT NULL,
  original_title varchar(500),
  summary        text,
  category       varchar(100),
  source         varchar(100),
  source_url     varchar(2000),
  google_url     varchar(2000),
  published_at   varchar(50),
  lang           varchar(10) DEFAULT 'ko',
  source_type    varchar(32),
  reject_reason  varchar(200) NOT NULL,
  confidence     varchar(10),
  judged_at      timestamp,
  created_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rejected_created_at ON rejected_articles (created_at);
-- 90일 경과분 정리(주 1회 또는 수동, 감사 후):
--   DELETE FROM rejected_articles WHERE created_at < now() - interval '90 days';
-- 롤백: DROP TABLE IF EXISTS rejected_articles;
