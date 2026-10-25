# 방송 보관 목록 (공개 · NEWS-Q14 ■5 · NEWS-Q15 ■1 · NEWS-Q16 ■4 · SOC 판정 ③ · 2026-10-25)

중독사회(SOC-R13 · R14) 연대기가 「어느 방송 편이 실림에서 빠져 보관층에 있나 · 지워졌나」를 짐작 대신 이 목록으로 맞춘다.
읽기만 · 인증 0 · LLM 0 · 스키마 변경 0.

## 주소

```
GET https://addicted-news-backend.onrender.com/api/broadcast/archive
GET https://addicted-news-backend.onrender.com/api/broadcast/archive?tier=all
```

| 질의 | 기본 | 뜻 |
|---|---|---|
| `tier` | `archive` | `archive` = 보관층 방송 + 지운 방송(전 기간) · `all` = 그에 더해 실림 방송(**전 기간** · 손으로 되돌린 편 `keep_ids` 가 `publish` 로 보임). 그 밖의 값은 `archive` 로 읽음 |

| 층 | 범위(NEWS-Q15 ■1 · NEWS-Q16 ■4) |
|---|---|
| `archive` | **전 기간**(날 수 제한 없음) |
| `deleted` | **전 기간** — `deleted_at` 이 찍힌 방송 행(층이 무엇이었든 `deleted`) · DB 에 그 열이 없으면 나오지 않음 |
| `publish` | `?tier=all` 일 때만 · **전 기간**(NEWS-Q16 ■4 · SOC-R14 C3 — 오래 숨긴 편이 복원돼도 120일 밖이라 목록에 못 돌아오던 것을 고침) |

- 이 목록은 방송(`source_type = 'broadcast'`)만이다. 기사는 나오지 않는다(기사 쪽 규칙은 바뀌지 않음).
- 최대 5,000(넘치면 보관 · 지운 편을 먼저, 그 안에서 최근에 바뀐 것을 남기고 `truncated: true`) · `id` 오름차순.
- 막힌 행(`blocked`)은 나오지 않는다. 거부된 편은 articles 에 없으므로 나오지 않는다.
- 60초 기억(같은 응답이 1분까지 되풀이될 수 있음).

## 응답(200)

```json
{
  "kind": "broadcast",
  "tier": "all",
  "days": null,
  "generatedAt": "2026-10-25T08:10:00.000Z",
  "available": true,
  "count": 4,
  "truncated": false,
  "items": [
    { "id": 4100, "tier": "deleted", "changedAt": "2026-08-02T01:00:00.000Z", "videoId": "Ab3dEfGhIjK" },
    { "id": 5300, "tier": "publish", "changedAt": "2026-05-01T03:00:00.000Z", "videoId": "Qw3rTyUiOpA" },
    { "id": 5868, "tier": "archive", "changedAt": "2026-10-21T03:18:50.743Z", "videoId": "x9YzA1b2C3d" },
    { "id": 6212, "tier": "archive", "changedAt": "2026-10-24T03:05:12.511Z", "videoId": null }
  ]
}
```

| 칸 | 꼴 | 뜻 |
|---|---|---|
| `id` | 정수 | articles id(공개 기사 상세 `GET /articles/:id` 와 같은 id) |
| `tier` | `archive` \| `deleted` \| `publish` | 지금 층(`deleted` = 지운 편) |
| `changedAt` | ISO 8601(UTC) | 층이 바뀐 때 = 행의 `updated_at`(지운 편은 `updated_at` · `deleted_at` 가운데 늦은 때) |
| `videoId` | 11자 글 \| `null` | 유튜브 영상 id(`https://www.youtube.com/watch?v=<videoId>`) — 행의 원문 주소에서 뽑음 · 못 뽑으면 `null`(NEWS-Q15 ■1) |
| `days` | `null` | 날 수 제한 없음(NEWS-Q16 ■4 부터 · 그 앞 Q14~Q15 는 실림에만 거는 `120`) |
| `available` | 불린 | `false` = tier 열이 없는 DB · DB 못 닿음 → `items` 는 `[]`(그래도 200) |

**항목 칸은 이 넷뿐이다 — 제목 · 요약 · 설명 · 원문 주소(URL 자체) · 채널 · DB 주소 · 열쇠 꼴 0.** 영상 id 는 내용이 아니라 이름표다. 응답은 health 와 같은 가림(redactPublic)을 거친다.

## changedAt 이 뜻하는 때

- NEWS-Q14 부터 층을 옮기는 실행(설정 `archive_ids` · `keep_ids` · 스팸 `spam_publishers.archive_ids` · NEWS-Q16 다시 판정 `rejudge_once` 의 yes)은 `updated_at` 을 함께 바꾼다 → 옮긴 때.
- 관문(언급 = partial)이나 같은 편 묶기(예고 · 클립 · 같은 회차 · 관련 클립 · 쇼츠 길이 이하)로 **처음부터 보관층에 저장된** 행 = 저장된 때.
- Q14 전에 옮긴 행(NEWS-Q12 `archive_ids` 11 편 · 10-23 12:00 실행) = 옮김 전 마지막으로 고친 때(대개 저장된 때). 옮긴 날은 `/api/health/runs` 의 `progress.broadcastArchivedIds` 로 맞춘다.
- NEWS-Q16 ■1 재업로드 방송의 날짜 맞춤(`published_at` = 원 방송일)은 층을 바꾸지 않으므로 `updated_at` 을 건드리지 않는다.
- 그림 채우기 같은 다른 고침도 이 시각을 뒤로 민다(층은 `tier` 로 본다).

## SOC-R13 · R14 이 읽는 법(권장)

1. 날마다 한 번(12:00 KST 수집 뒤 · 13:00 이후) `?tier=all` 을 읽어 `id → tier` 를 덮어쓴다.
2. 연대기의 방송을 `id` 로 맞추고, id 가 없는 옛 편은 `videoId` 로 맞춘다.
3. `archive` 면 「본편에 묶임/언급」으로 접는다 · `deleted` 면 숨긴다 · `publish` 로 돌아오면 다시 편다.
4. 세 층 모두 전 기간이다(NEWS-Q16 ■4). `truncated: false` 인 `?tier=all` 응답에 없는 id 는 막힌 행(`blocked`)이거나 articles 에 없는 편이다 —
   목록만 믿고 맞춰도 된다(오래 숨겼다 복원한 편도 `publish` 로 돌아온다). `truncated: true` 면 빠진 것만으로 판단하지 않는다.

## 바뀐 것(SOC 쪽 읽는 코드가 알아야 할 것)

| 날 | 판 | 바뀐 것 |
|---|---|---|
| 2026-10-24 | NEWS-Q14 ■5 | 처음 · 칸 id · tier · changedAt · 120일 |
| 2026-10-24 | NEWS-Q15 ■1 | 칸 `videoId` 더함 · 보관층 전 기간 · **기본(`?tier=archive`)에도 `tier: "deleted"` 가 나옴** — `archive` 가 아니면 `publish` 로 읽던 코드는 지운 편을 다시 보이게 하므로 `deleted` 를 따로 다뤄야 한다 |
| 2026-10-25 | NEWS-Q16 ■4 | `?tier=all` 의 실림도 **전 기간**(120일 제한 없앰) · `days` 가 `120` → **`null`** — 숫자로만 읽던 코드는 `null` 을 「제한 없음」으로 읽어야 한다 · 「120일 밖 publish id 는 마지막 층 유지」 규칙(읽는 법 4 옛 판)은 이제 필요 없음 |
