# 방송 보관 목록 (공개 · NEWS-Q14 ■5 · SOC 판정 ③ · 2026-10-24)

중독사회(SOC-R13) 연대기가 「어느 방송 편이 실림에서 빠져 보관층에 있나」를 짐작 대신 이 목록으로 맞춘다.
읽기만 · 인증 0 · LLM 0 · 스키마 변경 0.

## 주소

```
GET https://addicted-news-backend.onrender.com/api/broadcast/archive
GET https://addicted-news-backend.onrender.com/api/broadcast/archive?tier=all
```

| 질의 | 기본 | 뜻 |
|---|---|---|
| `tier` | `archive` | `archive` = 보관층 방송만 · `all` = 실림 방송도(손으로 되돌린 편 `keep_ids` 가 `publish` 로 보임). 그 밖의 값은 `archive` 로 읽음 |

- 범위: 최근 **120일** 안에 층이 바뀐(또는 그 층으로 저장된) 방송 행 · 최대 5,000(넘치면 최근에 바뀐 것을 남기고 `truncated: true`) · `id` 오름차순.
- `changedAt` 은 행이 마지막으로 고쳐진 때다 — 그림 채우기 같은 다른 고침도 이 시각을 뒤로 민다(층은 `tier` 로 본다).
- 숨긴 행(`deleted_at`) · 막힌 행(`blocked`)은 나오지 않는다. 거부된 편은 articles 에 없으므로 나오지 않는다.
- 60초 기억(같은 응답이 1분까지 되풀이될 수 있음).

## 응답(200)

```json
{
  "kind": "broadcast",
  "tier": "archive",
  "days": 120,
  "generatedAt": "2026-10-24T03:10:00.000Z",
  "available": true,
  "count": 2,
  "truncated": false,
  "items": [
    { "id": 5868, "tier": "archive", "changedAt": "2026-10-23T03:00:41.120Z" },
    { "id": 6141, "tier": "archive", "changedAt": "2026-10-24T03:04:12.511Z" }
  ]
}
```

| 칸 | 꼴 | 뜻 |
|---|---|---|
| `id` | 정수 | articles id(공개 기사 상세 `GET /articles/:id` 와 같은 id) |
| `tier` | `archive` \| `publish` | 지금 층 |
| `changedAt` | ISO 8601(UTC) | 층이 바뀐 때 = 행의 `updated_at` |
| `available` | 불린 | `false` = tier 열이 없는 DB · DB 못 닿음 → `items` 는 `[]`(그래도 200) |

**칸은 이 넷뿐이다 — 제목 · 요약 · 설명 · 주소(URL) · 채널 · DB 주소 · 열쇠 꼴 0.** 응답은 health 와 같은 가림(redactPublic)을 거친다.

## changedAt 이 뜻하는 때

- NEWS-Q14 부터 층을 옮기는 실행(설정 `archive_ids` · `keep_ids` · 스팸 `spam_publishers.archive_ids`)은 `updated_at` 을 함께 바꾼다 → 옮긴 때.
- 관문(언급 = partial)이나 같은 편 묶기(예고 · 클립 · 같은 회차 · 관련 클립 · 60초 미만)로 **처음부터 보관층에 저장된** 행 = 저장된 때.
- Q14 전에 옮긴 행(NEWS-Q12 `archive_ids` 11 편 · 10-23 12:00 실행) = 옮김 전 마지막으로 고친 때(대개 저장된 때). 옮긴 날은 `/api/health/runs` 의 `progress.broadcastArchivedIds` 로 맞춘다.

## SOC-R13 이 읽는 법(권장)

1. 날마다 한 번(12:00 KST 수집 뒤 · 13:00 이후) `?tier=all` 을 읽어 `id → tier` 를 덮어쓴다.
2. 연대기에 실린 방송 id 가 `archive` 면 「본편에 묶임/언급」으로 접는다. `publish` 로 돌아오면 다시 편다.
3. 120일 밖으로 나간 id 는 마지막으로 본 층을 그대로 둔다(목록에서 빠졌다고 지워진 것이 아님).
