# 중독뉴스 프론트 v2 — 배포 절차서 (Vercel)

Next.js(App Router) 프론트. 기존 Render 백엔드(`addicted-news-backend`)를 읽기 전용으로 소비.
**구 정적 사이트(`frontend/`)는 도메인 전환 완료 시까지 그대로 유지(롤백 경로).**

## 0. 환경변수
| 키 | 값 |
|----|----|
| `NEXT_PUBLIC_API_BASE` | `https://addicted-news-backend.onrender.com` |

로컬은 `frontend-v2/.env.local` 에, Vercel은 Project Settings → Environment Variables 에 등록.
(`.env.example` 참고. `.env*` 는 커밋 금지 — `.gitignore` 처리됨.)

## 1. 로컬 확인 (게이트 G2·G3·G6 은 여기서 검증)
> ⚠️ 클라우드 세션에서는 Render API 호스트가 egress 정책으로 차단되어 실데이터 렌더를
> 검증할 수 없습니다. 아래는 **데스크탑**에서 실행하세요.
```
cd frontend-v2
cp .env.example .env.local        # 필요 시 값 확인
npm install
npm run dev                        # http://localhost:3000
```
검증 체크리스트:
- [ ] G2: 홈/카테고리/기사상세/백과가 실데이터로 렌더
- [ ] G3: 백과 항목 — youtube_video_id **있는** 항목 상단에 임베드 / **없는** 항목엔 미표시
- [ ] G6: 요약 플레이스홀더 문자열이 화면에 **0건** (summary→teaser→title 폴백)
- [ ] `npm run build` 0 에러

## 2. Vercel 프로젝트 생성
1. Vercel 대시보드 → **Add New → Project** → GitHub 저장소 `syc2070-source/addicted-news` 연결.
2. **Root Directory 를 `frontend-v2` 로 지정** (중요 — 모노레포).
3. Framework Preset: **Next.js** (자동 감지). Build/Install 은 `vercel.json` 값 사용.
4. 위 환경변수(`NEXT_PUBLIC_API_BASE`) 등록 → **Deploy**.

## 3. 프리뷰 URL 검증 (이번 사이클 종료 지점)
프리뷰 URL(`*.vercel.app`)에서 위 G2·G3·G6 + 반응형(모바일/데스크탑) + 푸터 링크
(중독사회 `addictionsociety.net` / statory `statory.org`) 확인.

## 4. 도메인 전환 (사용자 확인 후 별도 실행 — 이번 사이클 아님)
1. 프리뷰 검증 통과 확인 후, Vercel Project → **Domains** 에 `addictionnews.net`(+`www`) 추가.
2. DNS(현 정적 사이트 호스팅)의 A/CNAME 를 Vercel 값으로 전환.
3. 전환 후 구 정적 사이트는 일정 기간 롤백 대비로 보존.

## 렌더링 정책
- 홈·카테고리·백과: **ISR 10분**(`revalidate = 600`).
- 기사 상세: ISR 5분. 검색: 동적(`force-dynamic`).
- SEO: 페이지별 `generateMetadata`(title/description/OG). 루트 `metadataBase = addictionnews.net`.
