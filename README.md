# 중독뉴스 (Addicted News)

중독 관련 뉴스를 자동 수집·요약·큐레이션하는 사이트.

## 구성

| 영역 | 기술 | 위치 |
|---|---|---|
| 백엔드 API | NestJS + TypeORM | `backend/` |
| 프론트엔드 | 정적 HTML + JS (`http-server`) | `frontend/` |
| 크롤러 | RSS Parser + OpenAI GPT-4o-mini | `backend/src/crawler/` |
| DB | PostgreSQL 18 | `addiction_news` |

---

## 빠른 실행

### 개발 서버 기동
```cmd
start.bat
```
- 백엔드: http://localhost:4000
- 프론트엔드: http://localhost:8080 (자동으로 브라우저 열림)

### 수동 크롤링 (1회)
```cmd
run-crawler.bat
```
- 소요 시간: 약 10~15분
- 로그: `backend/logs/crawl-last-run.log`

### 자동 크롤링 등록/해제 (관리자 권한)
```cmd
setup-schedule.bat     :: 매일 12:00 자동 실행 등록
remove-schedule.bat    :: 등록 해제
```
- 작업 이름: `AddictedNews Crawler Laptop`

---

## ⚠️ 실행 시 주의사항

### PowerShell에서 `&&` 사용 금지
PowerShell 5.1(Windows 기본)은 `&&` 연산자를 지원하지 않습니다.

```powershell
# ❌ 실패 (PS 5.1)
cd C:\addicted-news\backend && npm run crawl:once

# ✅ 권장
.\run-crawler.bat

# ✅ 대안 (cmd 호출)
cmd /c "cd /d C:\addicted-news\backend && npm run crawl:once"
```

**원칙: 모든 실행은 .bat 파일을 통해서만.**

---

## 환경 변수 (`backend/.env`)

```env
# DB
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD="..."
DB_NAME=addiction_news

# OpenAI (크롤러 GPT 요약용)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini

# HTTP 포트 (선택, 기본 4000)
# PORT=4000

# 크롤러 옵션
# AUTO_COLLECT_ENABLED=true
# SKIP_DAILY_CHECK=false
```

---

## 디렉토리 구조

```
C:\addicted-news\
├── backend\              # NestJS API + 크롤러
│   ├── src\
│   │   ├── articles\     # 기사 모듈
│   │   ├── crawler\      # 크롤러 (newsCrawler.ts)
│   │   └── main.ts
│   ├── logs\
│   │   ├── crawl.log              # 누적 요약 로그
│   │   └── crawl-last-run.log     # 마지막 실행 상세
│   └── .env
├── frontend\             # 정적 HTML/JS
│   ├── index.html
│   └── assets\
├── start.bat             # 개발 서버 기동
├── run-crawler.bat       # 수동 크롤
├── setup-schedule.bat    # 스케줄러 등록
└── remove-schedule.bat   # 스케줄러 해제
```

---

## API 엔드포인트 (공개)

```
GET /articles/latest           # 최신 기사
GET /articles/top              # TOP 뉴스
GET /articles/featured         # 기획기사
GET /articles/rapha            # 라파뉴스
GET /articles/issue            # 중독이슈
GET /articles/category/:slug   # 카테고리별
GET /articles/search?q=...     # 검색
GET /articles/:id              # 상세
```

관리자 API는 `Bearer` 인증 필요 (현재 단순 토큰, 추후 JWT 강화 예정).

---

## 트러블슈팅

### 크롤러가 작동 안 함
1. PostgreSQL 서비스 확인: `Get-Service postgresql*`
2. OpenAI 키 만료 여부 확인 (`crawl-last-run.log`에 401/429 검색)
3. `run-crawler.bat` 직접 실행 (PowerShell `&&` 구문 사용 금지)

### 일부 RSS 소스 404 / SSL 오류
- 외부 사이트 측 문제. 27개 중 일부가 죽어도 전체 파이프라인엔 영향 없음
- 반복 실패하는 소스는 `backend/src/crawler/sourceConfig.ts`에서 교체

### 작업 스케줄러 실행 결과 확인
```powershell
schtasks /query /tn "AddictedNews Crawler Laptop" /v /fo LIST
```
"마지막 결과" 코드가 `0`이면 성공.

### 프론트가 빈 화면
- 백엔드가 떠 있는지: `curl http://localhost:4000/articles/latest`
- 브라우저 콘솔에서 CORS·404 확인
- `frontend/assets/js/main.js`의 `API_BASE`가 백엔드 포트와 일치하는지

---

## 자매 프로젝트

- **중독사회** (`C:\addiction-society\`) — 연구자료·정책 매트릭스 아카이브
- 두 프로젝트는 공통 도메인 분류(D0~D3) 및 정책 축(P1~P6) 사용
