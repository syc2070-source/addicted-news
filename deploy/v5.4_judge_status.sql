-- v5.4 (작업1) — articles 판정 상태 컬럼. Supabase 에 1회 적용.
-- restored_manual 표기 기사는 judge_cleanup 재심사에서 제외됨.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS judge_status varchar(32);
-- 롤백: ALTER TABLE articles DROP COLUMN IF EXISTS judge_status;
