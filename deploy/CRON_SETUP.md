# Render Cron 설정 절차서 — 매일 자동 크롤

목표: 데스크탑을 켜지 않아도 매일 정해진 시각에 Render가 크롤러를 실행해
addictionnews.net 에 새 기사가 흐르게 한다.

> 코드/스케줄 정의는 `backend/render.yaml` 의 `type: cron` 서비스에 이미 있음.
> 아래는 **Render 대시보드에서 사람이 해야 하는 일**만 정리한 절차서다.
> (Render Cron Job 의 실행시간 제한·요금은 Render 문서/대시보드 사안이므로,
>  여기서는 "대시보드에 표시되는 값을 확인"하는 선에서만 안내한다.)

---

## 방법 A. Blueprint 로 한 번에 (권장, render.yaml 사용)

이미 `backend/render.yaml` 에 크론 서비스(`addicted-news-crawler`)가 정의돼 있다.

1. Render 대시보드 → **New +** → **Blueprint**
2. 이 레포(`addicted-news`) 연결 → render.yaml 감지 → **Apply**
3. 새로 생기는 `addicted-news-crawler`(cron) 의 **Environment** 탭에서
   `sync: false` 로 표시된 값들(아래 5번 목록)을 입력 → **Save**
4. 6번(첫 실행 수동 트리거)으로 검증

> ※ Blueprint 를 쓰지 않고 대시보드에서 직접 만들려면 방법 B.

---

## 방법 B. 대시보드에서 직접 Cron Job 생성

### 1) 서비스 생성
- Render 대시보드 → **New +** → **Cron Job**
- **Connect a repository** → `addicted-news` 레포 선택
- **Root Directory**: `backend`   ← (중요: 백엔드 폴더 기준)
- **Runtime**: Node

### 2) 빌드/실행 명령
- **Build Command**: `npm install && npm run build`
- **Command**(실행): `npm run crawl:prod`
  - `crawl:prod` = `node dist/crawler/newsCrawler.js` (빌드된 JS 실행, ts-node 불필요)

### 3) 스케줄
- **Schedule**: `0 3 * * *`
  - UTC 03:00 = **KST 12:00 (정오)**. 다른 시각을 원하면 UTC 기준으로 환산해 수정.
  - (예: KST 06:00 원하면 UTC 21:00 → `0 21 * * *`)

### 4) 리전 / 플랜
- **Region**: Singapore (웹서비스와 동일)
- **Instance Type / Plan**: 대시보드에 표시되는 옵션 중 선택.
  - 크롤 1회 20~40분 소요. **요금은 대시보드에 표시되는 금액을 확인**하고 선택할 것
    (Cron 은 실행 시간만큼 과금되는 방식이 일반적이나, 정확한 금액·정책은
    Render 대시보드/문서 표시값을 따른다).

### 5) 환경변수 (Environment)  ← env 는 서비스별로 분리됨!
웹서비스에 넣은 값이 **크론에는 자동 공유되지 않는다.** 아래를 **크론 서비스에
다시** 입력한다. (값은 각자 설정 — 여기 적지 말 것)

| Key | Value | 비고 |
|-----|-------|------|
| `NODE_VERSION` | `22` | |
| `SKIP_DAILY_CHECK` | `true` | 하루 1회 제한 해제(크론 스케줄이 그 역할) |
| `CRAWL_TIMEOUT_MS` | `2400000` | 상한 40분. 초과 시 수집분 저장 후 정상 종료 |
| `DB_HOST` | `<설정필요>` | Supabase |
| `DB_PORT` | `<설정필요>` | Supabase (예: 5432/6543) |
| `DB_USER` | `<설정필요>` | Supabase |
| `DB_PASSWORD` | `<설정필요>` | Supabase |
| `DB_NAME` | `<설정필요>` | Supabase |
| `DEEPSEEK_API_KEY` | `<설정필요>` | 요약용 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | |
| `MAX_FOREIGN_ARTICLES` | `100` | |
| `ENABLE_IMAGE_EXTRACT` | `true` | og:image 추출 |
| `STATORY_API_URL` | `<설정필요, 안 쓰면 생략>` | 선택 |
| `STATORY_NEWS_QUERY` | `<선택>` | |
| `STATORY_NEWS_LIMIT` | `<선택>` | |
| `STATORY_NEWS_REGION_HINT` | `<선택>` | |

> 참고: Render 는 자체적으로 `RENDER=true` 를 주입하므로, `SKIP_DAILY_CHECK` 를
> 깜빡해도 코드가 하루 1회 제한을 자동 해제한다(이중 안전장치).

### 6) 저장 후 첫 실행을 수동 트리거해 검증
1. 서비스 생성 완료 → **Manual Run**(또는 **Trigger Run**) 클릭
2. **Logs** 탭에서 진행 확인. 마지막에 아래 형태의 **END 요약**이 보이면 성공:
   ```
   ✅ END in NN분 NN초
      수집: N개 (한국 N, 외국 N)
      저장: N개, 이미지: N개 ...
      필터: 후보 N → 통과 N / 스킵 N ...
      DeepSeek 호출: 총 N회 (성공 N / 실패 N)
   ```
3. 종료 상태가 **Succeeded(exit 0)** 인지 확인.
   - 타임아웃으로 조기 종료돼도 그때까지 저장분은 유효하며 exit 0(Succeeded).
   - DB/키 오류 등 치명적 실패는 exit 1(**Failed**)로 표시되므로 로그에서 원인 확인.
4. 이후 매일 스케줄 시각에 자동 실행된다. Logs 로 매일 결과 확인 가능.

---

## 동작 요약 (코드에서 보장하는 것)
- **하루 1회 제한**: `SKIP_DAILY_CHECK=true` 또는 `RENDER=true`(Render 자동) 로 해제 →
  크론이 스킵되지 않음. (Render Cron 은 파일시스템도 휘발성이라 락 파일이 남지 않음.)
- **상한 타임아웃**: `CRAWL_TIMEOUT_MS`(기본 40분) 초과 시 남은 소스를 중단하고
  **그때까지 수집분을 저장**한 뒤 END 요약 출력, **정상 종료(exit 0)**.
- **피드 멈춤 방지**: RSS 요청 타임아웃 15초(`RSS_TIMEOUT_MS`), 원문/이미지 요청은
  axios 8초 타임아웃 → 개별 피드가 멈춰도 전체가 매달리지 않음.
- **종료 코드**: 정상/타임아웃 = 0, 치명적 오류 = 1 → Render 가 성공/실패를 구분.
- **END 요약 로그 유지** → Render Logs 에서 매일 결과 확인.

## 조정하고 싶을 때
- 실행 시각: `schedule` (UTC). 상한 시간: `CRAWL_TIMEOUT_MS`(ms).
- RSS 타임아웃: `RSS_TIMEOUT_MS`(ms). 외국기사 상한: `MAX_FOREIGN_ARTICLES`.
