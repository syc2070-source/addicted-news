# 읽기 전용 내보내기 문 v0 (NEWS-Q10 ■3 · 2026-10-19)

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
| `tier` | `publish` · `archive` · `all` | `all` | 게재 / 보관 / 둘 다. 거부 기사는 articles 표에 없으므로 나오지 않는다. |
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
      "sourceGrade": "press"
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
| `tier` | `publish`(게재) · `archive`(보관) | 열(tier)이 없으면 모두 `publish` |
| `sourceGrade` | 출처 등급(press · institution · academic · aggregator …) | 열(source_grade)이 없거나 값이 없으면 `null` |

내보내지 않는 것: 본문(raw_body) · 요약(summary) · 맛보기(teaser) · 핵심어 · 그림 주소 · 구글 링크 · 내부 표시(blocked_reason · judge_status) · 만든/고친 시각.
기사에 사람 이름이 나오는 것은 제목뿐이다(원문 매체가 이미 공개한 제목).

## 읽는 쪽 권장(Statory)

1. 처음: `?since=<시작일>&tier=all` → `nextCursor` 가 `null` 이 될 때까지.
2. 다음부터: 마지막으로 읽은 날을 `since` 로(겹침은 `id` 로 걸러 냄).
3. 같은 소식은 `clusterId` 로 묶어 이슈 하나로 보인다.
4. `tier = archive` 는 「근거로는 읽되 첫 화면에는 싣지 않음」으로 쓴다(사건·사고 보도 등 관문이 보관한 것).

## ECO-LINK1 계약 초안이 정할 것(이 문서 밖)

- 분야 id 이름표(`addiction` → Statory 분야 id) · 출처 등급 값 목록 고정 · 승인(누가 열쇠를 돌리나) · slug.
- v0 칸은 늘리기만 하고 빼거나 뜻을 바꾸지 않는다(바꾸면 v1).
