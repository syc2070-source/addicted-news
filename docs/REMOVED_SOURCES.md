# 제거된 RSS 소스 기록

## 2026-05-05 — sourceConfig.ts v3.0 → v3.1 (10개 제거)

크롤 결과 지속적인 실패가 확인된 소스를 제거했습니다.
도메인이 살아있거나 인증서 문제만 해결되면 부활 가능한 소스가 있으니,
주기적으로 (분기에 한 번 정도) 재시도해 볼 가치가 있습니다.

### 영구 폐기 / 도메인 변경 (재추가 시 새 URL 필요)

| 소스 ID | 매체 | 사유 | 비고 |
|---|---|---|---|
| `kr-mohw-policy` | 보건복지부 | HTTP 404 | RSS 서비스 폐지 가능성. 사이트 직접 확인 필요. |
| `kr-ngcc-news` | 사행산업통합감독위원회 | HTTP 404 | RSS 경로 변경 가능성. |
| `kr-okinews-local` | 옥천신문 | HTTP 404 | 사이트 개편 가능성. |
| `us-nida` | NIDA (NIH) | HTTP 404 | 새 URL: `https://nida.nih.gov/news-events/rss` 시도해 볼 만함 |
| `us-samhsa` | SAMHSA | HTTP 403 | 봇 차단. User-Agent 헤더 추가 시 우회 가능성. |
| `eu-emcdda` | EMCDDA → EUDA | Timeout | **EMCDDA가 2024년 7월 EUDA로 개명 (European Union Drugs Agency)**. 새 도메인 `https://www.euda.europa.eu/` 확인 필요. |

### 인증서 / 연결 문제 (Node.js 옵션 또는 헤더로 살릴 가능성)

| 소스 ID | 매체 | 사유 | 부활 방법 |
|---|---|---|---|
| `kr-mfds-narcotics` | 식품의약품안전처 | ECONNRESET | 일시적일 수 있음. 다음 크롤 때 재확인. |
| `kr-kcgp-press` | 한국도박문제예방치유원 | 인증서 검증 실패 | `node --use-system-ca` 옵션 추가 또는 `NODE_TLS_REJECT_UNAUTHORIZED=0` (보안상 비권장) |
| `kr-drugfree-kr` | 한국마약퇴치운동본부 | 인증서 검증 실패 | 위와 동일 |
| `uk-adf` | Alcohol and Drug Foundation | 자체 서명 인증서 | 위와 동일 |

### 부활 시도 절차

1. 브라우저로 RSS URL 직접 접속해 200 응답 확인
2. URL이 변경됐으면 사이트의 `/rss`, `/feed`, `/news/rss.xml` 등 탐색
3. `sourceConfig.ts`에 다시 추가 후 `npm run crawl:once` 단발 실행
4. `crawl-last-run.log`에서 해당 sourceId의 결과 확인
5. `Done: N collected` 또는 0 이상이면 정상

### 다음 점검 권장 시점

- 분기별 (3개월에 한 번) 위 소스들 URL 재점검
- 또는 신규 RSS 후보 발견 시 함께 재정비
