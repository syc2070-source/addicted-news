-- 중독백과 테이블 (synchronize:false 이므로 수동 생성)
-- 실행: psql "$DATABASE" -f encyclopedia.sql   (또는 DB_* 로 접속)
CREATE TABLE IF NOT EXISTS encyclopedia_terms (
  id            text PRIMARY KEY,          -- slug
  term_ko       text NOT NULL,
  term_en       text NOT NULL,
  category      text NOT NULL,             -- mechanism|psychology|substance|behavioral|diagnosis|recovery|society|policy|program|figures
  definition    text NOT NULL,
  example       text NOT NULL DEFAULT '',
  see_also      jsonb NOT NULL DEFAULT '[]',
  trend         boolean NOT NULL DEFAULT false,
  sensitive     boolean NOT NULL DEFAULT false,  -- true면 상담 안내 자동 병기, 방법·수치 금지
  video_url     text,                       -- 영상 워커가 채움 (예: /assets/videos/도박장애.mp4)
  video_status  text NOT NULL DEFAULT 'pending', -- pending|rendering|ready|failed
  published     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enc_category  ON encyclopedia_terms(category);
CREATE INDEX IF NOT EXISTS idx_enc_trend     ON encyclopedia_terms(trend);
CREATE INDEX IF NOT EXISTS idx_enc_published ON encyclopedia_terms(published);
