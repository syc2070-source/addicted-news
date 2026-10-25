# 오너 공개 자료 → 기획기사 · 리포트 칸 (NEWS-Q16 ■5 · 2026-10-25 · 스위치 꺼짐)

오너의 중독 자료(보고서 · 현황자료)를 중독뉴스 「기획기사」 · 「리포트」 칸으로 들이는 문. **지금 만들어 두고 스위치는 꺼 둔다** — 켜기 전에는 손님 화면 · API 응답이 바뀌지 않는다.
LLM 0 · DB 쓰기 0 · 스키마 0.

## 지금 그 칸이 채워지는 길(10-25 실측)

| 칸 | 지금 있는 것 | 들어온 길 |
|---|---|---|
| 첫 화면 「기획기사」 상자 · `feature.html` | 「Statory 보고서」 두 편(중독이란? · 중독의 과거와 미래 · 2026-07-03) | **가져오기(실시간 대리)** — 화면이 `GET /reports?limit=3`(기획기사 페이지는 20)을 부르고, 백엔드 `ReportsController` 가 Statory API `STATORY_API_URL/api/reports?scenario_id=addiction` 을 그대로 대리해 돌려준다. 이 DB 에 저장되지 않음 · 시드 아님 · 관리자 입력 아님 |
| 같은 상자의 기사 쪽 | 0 편 | **관리자 입력** — 관리자 화면(`admin.html`)의 「기획기사」 체크 → `PUT /admin/articles/:id/feature`(최대 3 · 넘치면 오래된 것 해제) → `GET /articles/featured` |
| `reports.html` 「리포트」 | 「스태토리 랩 리포트가 준비 중입니다」 고정 글 | 화면에 박힌 글(API 를 부르지 않음) |

## 문(이번 판)

같은 길(`GET /reports`)에 단다. 스위치를 켜면 오너 항목이 Statory 보고서와 **같은 꼴(ReportCard)** 로 섞여 나오므로 기획기사 상자 · 기획기사 페이지가 고칠 것 없이 그대로 보인다(출처 이름만 「오너」 · 링크는 오너 링크).

- 받는 곳: `backend/data/owner_materials.json` 의 `items[]`(저장소 파일 · 배포로 반영 · 오너가 글을 주면 실행자가 이 파일에 넣고 커밋).
- 스위치: 분야 설정 `backend/data/field_profiles/addiction.json` → `sources.owner_materials.enabled`(지금 **false**) · `max_items`(기본 20).
- 코드: `backend/src/reports/owner_materials.ts`(꼴 확인 · 읽기 · 카드 · 섞기) · `reports.controller.ts`(목록 · 상세) · `frontend/assets/js/main.js` `reportToSlotItem`(출처 이름 · 링크).

## 들어오는 꼴(한 항목)

```json
{
  "id": "gambling-status-2026q3",
  "kind": "status",
  "title": "2026년 3분기 도박 중독 현황",
  "summary": "상담 · 치료 기관 자료로 본 분기 현황 요약(600자까지).",
  "body": "본문(20,000자까지 · 글).",
  "link": "https://example.org/owner/report.pdf",
  "date": "2026-10-20",
  "source": "오너",
  "public": true
}
```

| 칸 | 반드시 | 꼴 |
|---|---|---|
| `id` | ○ | 소문자 · 숫자 · `-`(1~60자 · 앞뒤는 글자/숫자) · 파일 안에서 하나뿐 — 공개 id 는 `owner-<id>` |
| `kind` | ○ | `report`(보고서) \| `status`(현황자료) |
| `title` | ○ | 1~200자 |
| `summary` | ○ | 1~600자 |
| `body` · `link` | 둘 중 하나 이상 | `body` = 글(20,000자까지) · `link` = `https://` 주소(2,000자까지 · 호스트는 글자 · 숫자 · `.` · `-` 만 · 정규화한 꼴에 따옴표 · `<>` · 빈칸이 남으면 거부) |
| `date` | ○ | `YYYY-MM-DD`(있는 날) |
| `source` | ○ | `"오너"` 고정 |
| `public` | ○ | 불린 — `true` 만 내보냄(`false` = 넣어 두되 숨김) |

꼴이 틀린 항목 · 같은 id 둘째는 내보내지 않는다(응답에 까닭을 싣지 않음 · 서버 로그에 프로세스마다 한 번 `오너 공개 자료 꼴 틀림 N건` · 시험 `owner_materials.spec.ts`).

**주의(지금 화면 한계)**: 화면은 카드의 `link_url` 로만 이어진다. `link` 없이 `body` 만 있는 항목은 목록에 제목만 보이고(기획기사 페이지는 「보고서 준비 중」) 본문은 `GET /reports/owner-<id>` 로만 읽힌다 — 본문 화면을 만들기 전에는 `link` 를 함께 넣는다(CTO 판정 2).

## 내보내는 꼴(스위치 켜짐)

`GET /reports` — Statory 응답에 오너 카드를 섞는다(오너 카드는 첫 쪽 `offset=0` 에만 · `published_at` 늦은 것 먼저 · `limit` 까지 · `count` = Statory 전체 수 + 오너 수). `scope` · `domain` · `region` 으로 좁힌 목록에는 섞지 않는다. 공개 항목이 하나도 없으면 Statory 응답을 그대로 돌려준다(다시 줄 세우지 않음).
Statory 가 꺼져 있거나(`STATORY_API_URL` 없음) 실패해도 오너 카드는 나온다.
**쪽 넘김은 첫 쪽만 맞다** — 첫 쪽에서 오너 카드에 밀린 Statory 항목은 둘째 쪽(`offset=N`)에 나오지 않는다. 지금 화면은 `offset=0`(3 · 20)만 쓰므로 영향 없음.

```json
{ "id": "owner-gambling-status-2026q3", "scenario_id": "addiction", "scope": "owner",
  "title_ko": "2026년 3분기 도박 중독 현황", "title_en": null, "summary_ko": "…",
  "category": "status", "published_at": "2026-10-20T00:00:00+09:00",
  "origin": "owner", "source_label": "오너", "link_url": "https://example.org/owner/report.pdf",
  "conclusion_ko": null, "key_findings": [], "thumbnail_chart_json": null, "domain": null, "region": null,
  "engines_count": 0, "sections_count": 0, "view_count": 0, "sections_json": null }
```

`GET /reports/owner-<id>` → `{ "found": true, "item": { …카드…, "body_ko": "본문 또는 null" } }` · 없는 id · 비공개 = `{ "found": false, "item": null }` · 스위치 꺼짐 = 예전처럼 Statory 로 대리.

## 켜는 법(때가 오면 · 오너 판정 뒤)

1. `owner_materials.json` 의 `items` 에 항목을 넣는다(꼴은 위 표).
2. `addiction.json` 의 `sources.owner_materials.enabled` 를 `true` 로.
3. 커밋 · push → 배포(Render) 뒤 `GET /reports?limit=3` 에 `origin: "owner"` 카드가 보이면 끝.
4. 끄기 = `enabled: false` 로 되돌리고 배포(파일의 항목은 남겨 둬도 나가지 않음).

## 남은 것(CTO 판정)

- 「리포트」 페이지(`reports.html`)는 지금 고정 글 — 오너 자료를 여기에도 보일지(같은 `GET /reports` 로 목록을 그리기) · `kind` 로 나눌지(보고서 = 리포트 · 현황자료 = 기획기사 등).
- 받는 길을 파일(배포) 대신 관리자 API(DB 저장)로 둘지 — 그러면 저장 칸(묶음 SQL)이 필요하다.
