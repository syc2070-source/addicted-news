# 읽기 전용 내보내기 문 v0 (NEWS-Q10 ■3 · 2026-10-19 · NEWS-Q12 ■4 칸 셋 더함 · 2026-10-22)

중독뉴스(분야 `addiction`)가 Statory 서재 입구(11월 · LT15)에 기사 **목록 칸만** 내어 주는 읽기 전용 문.
ECO-LINK1 계약 초안(분야 id · 출처 등급 · 승인 · slug)이 이 문서를 참조한다.

- 코드: `backend/src/export/` (export.controller.ts · export.service.ts · export.spec.ts)
- 쓰기 0 · 스키마 변경 0 · 본문·요약·개인정보 0 · LLM 0

## 켜기 / 끄기

| 상태 | 조건 | 응답 |
|------|------|------|
| 꺼짐(기본) | Render env 에 `EXPORT_READ_KEY` 가 없음 | **404** (문이 없는 것과 같음) |
| 켜짐 · 열쇠 틀림/없음 | env 있음 · 요청 머리 열쇠가 다름 | **401** |
| 켜짐 · 열쇠 맞음 | env 있음 · 요청 머리 열쇠가 같음 | **200** + 아래 꼴 |

- 열쇠는 오너가 11월에 Render env 로 넣는다(이 판은 넣지 않음 · 설정 화면 조작 0).
- 열쇠는 **요청 머리로만** 받는다: `x-export-key: <열쇠>` 또는 `Authorization: Bearer <열쇠>`.
  주소(`?key=`)로는 받지 않는다(접속 로그에 남기 때문).
- 비교는 해시 뒤 같은 시간 비교(timingSafeEqual).

## 요청

```
GET /api/export/articles?since=&kind=&tier=&cursor=
```

| 칸 | 값 | 기본 | 뜻 |
|----|----|------|----|
| `since` | `2026-10-01` 또는 `2026-10-01T00:00:00+09:00` | 없음(처음부터) | 이 시각 뒤에 **들어온**(created_at) 기사. 날짜만 주면 KST 0시. 시각은 시각대(Z · ±hh:mm) 필수. |
| `kind` | `article` · `broadcast` · `all` | `all` | 기사 / 방송(source_type = broadcast) / 둘 다 |
| `tier` | `publish` | `publish` | 게재만(NEWS-Q13 ■4 CTO 판정 ③ · 10-23). `archive` · `all` = **400**. 보관층(관문 「언급」 · 본편에 묶인 예고·클립)은 내보내지 않는다. 거부 기사는 articles 표에 없으므로 나오지 않는다. |
| `cursor` | 앞 응답의 `nextCursor` 그대로 | 없음 | 다음 쪽 |

- 한 쪽 = **200** 행. `id` 오름차순(들어온 차례). `nextCursor` 가 `null` 이면 끝.
- 같은 조건(since·kind·tier)에 cursor 만 바꿔 이어 읽는다.
- 틀린 값 = **400**(까닭 한 줄).
- 숨김: `blocked = true` · soft 삭제(`deleted_at` 열이 있을 때 `deleted_at IS NOT NULL`)는 나오지 않는다.

## 응답(200)

```json
{
  "field": "addiction",
  "version": "v0",
  "limit": 200,
  "items": [
    {
      "id": 5672,
      "title": "청소년 도박 첫 경험 13.9세…",
      "source": "연합뉴스",
      "publishedAt": "2026-10-18",
      "publishedTs": "2026-10-18T01:00:00.000Z",
      "sourceUrl": "https://www.yna.co.kr/view/…",
      "field": "addiction",
      "category": "도박중독",
      "clusterId": "5650",
      "tier": "publish",
      "sourceGrade": "press",
      "sourceType": "kr_press",
      "subtype": ["gambling"],
      "sourceEn": null
    },
    {
      "id": 5873,
      "title": "[PD수첩] \"도박소년이 된 내 아들\" - 2026년 8월 11일 밤 10시 20분 방송",
      "source": "MBC PD수첩",
      "publishedAt": "2026-08-11",
      "publishedTs": "2026-08-11T14:21:16.000Z",
      "sourceUrl": "https://www.youtube.com/watch?v=…",
      "field": "addiction",
      "category": "도박중독",
      "clusterId": null,
      "tier": "publish",
      "sourceGrade": "press",
      "sourceType": "broadcast",
      "subtype": ["gambling"],
      "sourceEn": "MBC PD Notebook"
    }
  ],
  "nextCursor": "aWQ6NTY3Mg"
}
```

| 칸 | 뜻 | 없을 때 |
|----|----|---------|
| `id` | 중독뉴스 기사 id(영구 · `/articles/:id` 와 같음) | — |
| `title` | 제목(외국어 기사는 한국어 번역 제목) | — |
| `source` | 매체 이름 | — |
| `publishedAt` | 보도 날짜(YYYY-MM-DD 또는 원문 꼴) | — |
| `publishedTs` | 보도 시각(ISO · UTC) | 열(published_ts)이 없거나 값이 없으면 `null` |
| `sourceUrl` | 원문 주소 | — |
| `field` | 분야 꼬리표(분야 설정 field) | — |
| `category` | 분야 안 분류(중독정책 · 알코올·약물중독 · 도박중독 · 게임·디지털중독 · 중독사회와 회복) | — |
| `clusterId` | 사건 묶음 id(같은 소식 기사끼리 같음 · 가장 이른 보도의 id) | 열(cluster_id)이 없거나 값이 없으면 `null` |
| `tier` | 늘 `publish`(게재 · NEWS-Q13 부터 보관은 내보내지 않음 — 칸은 남김) | 열(tier)이 없으면 모두 `publish` |
| `sourceGrade` | 출처 등급(press · institution · academic · aggregator …) | 열(source_grade)이 없거나 값이 없으면 `null` |
| `sourceType` | 출처 종류(NEWS-Q12 · `broadcast` · `kr_press` · `world_press` · `institution` · `academic` · `specialty` · `aggregator` …) | 값이 없으면 `null` |
| `subtype` | 하위 분야 영문 id 배열(NEWS-Q12 · 아래 표) — 여럿일 수 있음 | 어느 묶음에도 안 들면 `[]` |
| `sourceEn` | 방송 프로그램 영어 이름(NEWS-Q12 · `sourceType = broadcast` 일 때만 · 아래 표) | 방송이 아니거나 모르면 `null` |

### subtype 영문 id (NEWS-Q12 ■4)

분야 설정 `keywords.groups`(핵심어 묶음) → `keywords.group_ids` 로 옮긴다. 제목 + 꼬리표(keywords)에 묶음 낱말이 있으면 그 id(방송은 관문이 고른 하위 주제 꼬리표 포함). 요약·본문은 읽지 않는다.

| 묶음 | id |
|------|----|
| 도박 | `gambling` |
| 알코올 | `alcohol` |
| 약물 | `drugs` |
| 담배 | `tobacco` |
| 게임·디지털 | `gaming` · `digital` (묶인 범주 = 둘 다) |
| 일 | `work` |
| 음식 | `food` |
| AI | `ai` |
| 쇼핑 | `shopping` |
| 기타 | (빈 배열) |

### sourceEn — 방송 9 채널 (backend/data/broadcast_youtube_rss.json `program_en`)

sourceEn 은 `program_en` 한 칸에서만 나온다. `name_source`(NEWS-Q13 ■5 · 10-23 웹 읽기) = official(방송사·채널이 스스로 쓰는 영어 이름) | translation(공식 표기를 못 찾아 번역).

| source | sourceEn | name_source |
|--------|----------|-------------|
| MBC PD수첩 | MBC PD Notebook | translation(영어 신문 표기) |
| MBC 스트레이트 | MBC Straight | translation |
| SBS 그것이 알고 싶다 | SBS Unanswered Questions | translation |
| SBS 스페셜 | SBS Special | official(SBS Star · SBSi) |
| KBS 추적60분 | KBS In-Depth 60 Minutes | translation |
| KBS 시사기획 창 | KBS Current Affairs Window | translation |
| KBS 다큐인사이트 | KBS Docu Insight | translation |
| EBS 다큐프라임 | EBS Docuprime | translation |
| 뉴스타파 | Newstapa | official(YouTube 채널 이름) |

내보내지 않는 것: 본문(raw_body) · 요약(summary) · 맛보기(teaser) · 핵심어 원문(subtype 셈에만 읽음) · 그림 주소 · 구글 링크 · 내부 표시(blocked_reason · judge_status) · 만든/고친 시각.
기사에 사람 이름이 나오는 것은 제목뿐이다(원문 매체가 이미 공개한 제목).

## 읽는 쪽 권장(Statory)

1. 처음: `?since=<시작일>` → `nextCursor` 가 `null` 이 될 때까지.
2. 다음부터: 마지막으로 읽은 날을 `since` 로(겹침은 `id` 로 걸러 냄).
3. 같은 소식은 `clusterId` 로 묶어 이슈 하나로 보인다.
4. (NEWS-Q13 ■4) 보관층은 v0 에서 나오지 않는다 — 문을 켜기 전(10-23 · 404) 바꿈이라 읽는 쪽 영향 0. 이미 받은 행이 뒤에 보관으로 바뀌어도 v0 는 알리지 않는다(지움·바뀜 알림은 v1 몫).

## ECO-LINK1 계약 초안이 정할 것(이 문서 밖)

- 분야 id 이름표(`addiction` → Statory 분야 id) · 출처 등급 값 목록 고정 · 승인(누가 열쇠를 돌리나) · slug.
- v0 칸은 늘리기만 하고 빼거나 뜻을 바꾸지 않는다(바꾸면 v1).

## 변경 기록

| 날 | 판 | 바뀐 것 | 판 번호 |
|---|---|---|---|
| 2026-10-19 | NEWS-Q10 ■3 | v0 문 처음(꺼진 채 404 · 열쇠 env 있을 때만 켜짐) | v0 |
| 2026-10-22 | NEWS-Q12 ■4 | 칸 셋 더함(subtype · sourceEn · clusterId) — 늘리기만 | v0 |
| 2026-10-23 | NEWS-Q13 ■4 | `tier` 기본값 실림만(`publish`) · `archive` · `all` = 400. 보관층은 내보내지 않음 | **v0 유지**(읽는 쪽 0 — 문이 꺼진 채 404 였고 받아 간 쪽 없음 · NEWS-Q14 ■6 CTO 판정 ⑤) |
| 2026-10-24 | NEWS-Q14 ■5 | 방송 보관 목록은 이 문이 아니라 따로 공개(`GET /api/broadcast/archive` · docs/BROADCAST_ARCHIVE_LIST.md) — 이 문 칸은 그대로 | v0 |
