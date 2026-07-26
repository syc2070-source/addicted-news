# Render 백엔드 환경변수 (addicted-news)

Render Web Service → Environment 에 아래 키를 설정하세요.
값은 Supabase·Render 대시보드에서 발급받은 실제 값으로 채웁니다.

## 필수

| 키 | 값 |
|----|-----|
| `DB_HOST` | `<설정필요>` (Supabase pooler host) |
| `DB_PORT` | `<설정필요>` (보통 5432 또는 6543) |
| `DB_USER` | `<설정필요>` |
| `DB_PASSWORD` | `<설정필요>` |
| `DB_NAME` | `<설정필요>` (예: postgres) |
| `ADMIN_PASSWORD` | `<설정필요>` |
| `DEEPSEEK_API_KEY` | `<설정필요>` |
| `DEEPSEEK_MODEL` | `<설정필요>` (예: deepseek-v4-flash(또는 deepseek-v4-pro)) |
| `CORS_ORIGINS` | `<설정필요>` (예: https://addictionnews.net,https://www.addictionnews.net) |
| `PORT` | `<설정필요>` (Render가 자동 주입 시 생략 가능) |

## Statory 연동 (보고서·크롤러)

| 키 | 값 |
|----|-----|
| `STATORY_API_URL` | `<설정필요>` |
| `STATORY_NEWS_QUERY` | `<설정필요>` |
| `STATORY_NEWS_LIMIT` | `<설정필요>` |
| `STATORY_NEWS_REGION_HINT` | `<설정필요>` |

## 크롤러 옵션 (Cron Job에서 동일 env 사용 시)

| 키 | 값 |
|----|-----|
| `SKIP_DAILY_CHECK` | `<설정필요>` |
| `MAX_FOREIGN_ARTICLES` | `<설정필요>` |
| `ENABLE_IMAGE_EXTRACT` | `<설정필요>` |
| `ENABLE_AI_IMAGE` | `<설정필요>` |
| `CRAWL_SOURCE_TYPES` | `<설정필요>` (선택) |
| `CRAWL_MAX_SOURCES` | `<설정필요>` (선택) |

## 미사용·로컬 전용 (Render에 넣지 않음)

| 키 | 비고 |
|----|------|
| `OPENAI_API_KEY` | 코드 미참조 (레거시) |
| `OPENAI_MODEL` | 코드 미참조 |
| `PEXELS_API_KEY` | video_pipeline 로컬 전용 |

## Vercel 프론트 (별도)

정적 `frontend/assets/js/config.js` 에서 설정:

| 전역 변수 | 배포 값 |
|-----------|---------|
| `window.API_BASE` | `<설정필요>` (Render 백엔드 URL, 예: https://addicted-news-api.onrender.com) |
| `window.ADDICTION_SOCIETY_URL` | `<설정필요>` (중독사회 배포 후, 미배포 시 빈 문자열) |
